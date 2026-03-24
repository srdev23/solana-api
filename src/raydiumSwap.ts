import {
  PublicKey,
  Keypair,
  VersionedTransaction,
  TransactionMessage,
  TransactionInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_PROGRAM_ID, getMint } from "@solana/spl-token";
import base58 from "bs58";
import {
  jsonInfo2PoolKeys,
  Liquidity,
  LiquidityPoolKeys,
  Percent,
  Token,
  TokenAmount,
} from "@raydium-io/raydium-sdk";
import { Request, Response, Router } from "express";
import { logger } from "../logger"; // Ensure to adjust the path as needed

import {
  createTraderAPIMemoInstruction,
  HttpProvider,
  MAINNET_API_NY_HTTP,
} from "@bloxroute/solana-trader-client-ts";
import {
  
  getWalletBalance,
  getWalletTokenAccount,
  retrieveEnvVariable,
  sleep,
} from "./utils";
import { fetchPoolInfoByMint } from "./raydium/formatAmmKeysById";
import {
  AUTH_HEADER,
  BLOXROUT_RECEIVER,
  connection,
  SYS_FEE,
  SYS_FEE_RECEIVER,
} from "../config";
import rateLimit from "express-rate-limit";
import cors from "cors";
import { morganMiddleware } from "../logger";

const swapRaydiumToken = async (
  req: Request,
  res: Response,
  isBuy: boolean
) => {
  const {
    private_key,
    mint,
    amount,
    microlamports,
    units,
    slippage,
    tip = 0.001,
  } = req.body;
  if (!private_key || !mint || !amount || !microlamports || !units || !slippage)
    return res
      .status(400)
      .json({ status: "failed", message: "Missing required parameters" });
  try {
    logger.info(`Received POST request: ${JSON.stringify(req.body)}`);

    const provider = new HttpProvider(
      AUTH_HEADER,
      private_key,
      MAINNET_API_NY_HTTP
    );
    const bXtip = tip * LAMPORTS_PER_SOL;
    const memo = createTraderAPIMemoInstruction("");

    const userKeypair = Keypair.fromSecretKey(
      Buffer.from(base58.decode(private_key))
    );
    const mintAddress = new PublicKey(mint);
    const slippageP = new Percent(slippage, 100);

    const mintInfo = await getMint(connection, mintAddress);
    const decimal = mintInfo.decimals;

    const WSOL_TOKEN = new Token(
      TOKEN_PROGRAM_ID,
      NATIVE_MINT,
      9,
      "WSOL",
      "WSOL"
    );
    const MINT_TOKEN = new Token(TOKEN_PROGRAM_ID, mint, decimal);
    const inputToken = isBuy ? WSOL_TOKEN : MINT_TOKEN;
    const outputToken = isBuy ? MINT_TOKEN : WSOL_TOKEN;
    const inDecimal = isBuy ? 9 : decimal;
    const inAmount = Number((amount * 10 ** inDecimal).toFixed(0));
    

    const inputTokenAmount = new TokenAmount(inputToken, inAmount);
    const walletTokenAccounts = await getWalletTokenAccount(
      connection,
      userKeypair.publicKey
    );
    console.log("0");
    const targetPoolInfo = await fetchPoolInfoByMint(mint);
    if (!targetPoolInfo) {
      await sleep(100);
      return await swapRaydiumToken(req, res, isBuy);
    }
    const poolKeys = jsonInfo2PoolKeys(targetPoolInfo) as LiquidityPoolKeys;
    const minA = new TokenAmount(MINT_TOKEN, 1);

    console.log("1");

    const { amountOut, minAmountOut } = Liquidity.computeAmountOut({
      poolKeys: poolKeys,
      poolInfo: await Liquidity.fetchInfo({ connection, poolKeys }),
      amountIn: inputTokenAmount,
      currencyOut: outputToken,
      slippage: slippageP,
    });
    console.log("2");

    // -------- step 2: create instructions by SDK function --------
    const { innerTransactions } = await Liquidity.makeSwapInstructionSimple({
      connection,
      poolKeys,
      userKeys: {
        tokenAccounts: walletTokenAccounts,
        owner: userKeypair.publicKey,
      },
      amountIn: inputTokenAmount,
      amountOut: minAmountOut,
      fixedSide: "in",
      makeTxVersion: 0,
    });
    console.log("3");

    const instructions: TransactionInstruction[] = [];
    instructions.push(
    //   ComputeBudgetProgram.setComputeUnitPrice({
    //     microLamports: microlamports,
    //   }),
    //   ComputeBudgetProgram.setComputeUnitLimit({ units: units }),
      ...innerTransactions.flatMap((tx) => tx.instructions),
      SystemProgram.transfer({
        fromPubkey: userKeypair.publicKey,
        toPubkey: BLOXROUT_RECEIVER,
        lamports: bXtip,
      }),
      SystemProgram.transfer({
        fromPubkey: userKeypair.publicKey,
        toPubkey: SYS_FEE_RECEIVER,
        lamports: SYS_FEE,
      }),
      memo
    );
    console.log("4");

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash();
    const messageV0 = new TransactionMessage({
      payerKey: userKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();
    console.log("5");

    const txn = new VersionedTransaction(messageV0);
    txn.sign([userKeypair]);
    console.log("6");

    // We first simulate whether the transaction would be successful
    const { value: simulatedTransactionResponse } =
      await connection.simulateTransaction(txn, {
        replaceRecentBlockhash: true,
        commitment: "processed",
      });
    const { err, logs } = simulatedTransactionResponse;
    console.log("7");

    console.log("🚀 Simulate ~", Date.now());

    if (err) {
      console.error("Simulation Error:");
      console.error({ err, logs });
      return;
    }
    console.log("8");

    const serializeTxBytes = txn.serialize();
    const buff = Buffer.from(serializeTxBytes);
    const encodedTxn = buff.toString("base64");
    const response = await provider.postSubmit({
      transaction: { content: encodedTxn, isCleanup: false },
      skipPreFlight: false,
    });
    const sig = response.signature;
    console.log(
      `✅ Txn placed successfully\nSignature: https://solscan.io/tx/${response.signature}`
    );
    const confirmation = await connection.confirmTransaction({
        signature: sig,
        lastValidBlockHeight: lastValidBlockHeight,
        blockhash: blockhash,
    }, "confirmed");
    if (confirmation.value.err) {
      console.log("fail");
      return res.status(500).json({
        status: "failed",
        txid: sig,
        message: "Transaction confirmation error",
      });
    } else {
      console.log("success");
      if (isBuy)
        return res.status(200).json({
          status: "success",
          tokens: (amountOut.raw.toNumber() / 10 ** decimal).toFixed(10),
          txid: sig,
        });
      return res.status(200).json({
        status: "success",
        txid: sig,
      });
    }
  } catch (error) {
    console.log(`Error during transaction: ${error}`);
    return res.status(500).json({
      status: "failed",
      message: "Unknown error occurred",
      error: error.message,
    });
  }
};

const router = Router();
// Middleware for CORS
router.use(cors());

// Middleware for logging
router.use(morganMiddleware);

// Middleware for rate limiting
const limiter = rateLimit({
  windowMs: 1000, // 1 second window
  max: 20, // 20 requests per IP per second
  message: {
    status: "failed",
    message: "Too many requests, please try again later.",
  },
});
router.use(limiter);
router.post("/buy", (req: Request, res: Response) => {
  swapRaydiumToken(req, res, true);
});
router.post("/sell", (req: Request, res: Response) => {
  swapRaydiumToken(req, res, false);
});

export default router;