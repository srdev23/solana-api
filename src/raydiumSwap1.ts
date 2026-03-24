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
  
  getRaydiumInfo,
  getWalletBalance,
  getWalletTokenAccount,
  retrieveEnvVariable,
  sleep,
} from "./utils";
import { formatAmmKeysById } from "./raydium/formatAmmKeysById1";
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

const getRaydiumTokenPrice = async (
  req: Request,
  res: Response
) => {
  const mint = req.query.mint;
  if(!mint)
    return res.status(400).json({ error: "Mint address is required" });
  console.log(mint);
  const poolInfo = await getRaydiumInfo(mint.toString());
  if (!poolInfo) {
    console.error("Failed to retrieve pool info...");
    return res.status(400).json({ error: "Invalid mint address" });
  }
  const SOL_USD_PRICE = retrieveEnvVariable("SOL_USD_PRICE");

  if(poolInfo.mintA.address === NATIVE_MINT.toString())
    return res.status(200).json({ 
      priceInSOL: (1 / poolInfo.price).toFixed(9),
      priceInUSD: (1 / poolInfo.price * Number(SOL_USD_PRICE)).toFixed(9),
    });
  return res.status(200).json({ 
    priceInSOL: poolInfo.price.toFixed(9), 
    priceInUSD: (poolInfo.price * Number(SOL_USD_PRICE)).toFixed(9)
  });
}

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
    new PublicKey(mint);
  } catch (error) {
    return res
    .status(400)
    .json({ status: "failed", message: "Invalid mint address" });  
  }

  try {
    logger.info(`Received POST request: ${JSON.stringify(req.body)}`);

    const provider = new HttpProvider(
      AUTH_HEADER,
      private_key,
      MAINNET_API_NY_HTTP
    );

    let userKeypair: Keypair;
    try{
      userKeypair = Keypair.fromSecretKey(base58.decode(private_key));
    }catch(e){
      return res
        .status(400)
        .json({ status: "failed", message: "Invalid Private Key" });
    }
    const bXtip = tip * LAMPORTS_PER_SOL;
    const memo = createTraderAPIMemoInstruction("");
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
    // const solBal = await connection.getBalance(userKeypair.publicKey)
    // if(isBuy)
    // {
    //   if(solBal < inAmount + bXtip)
    //     return res
    //       .status(400)
    //       .json({ status: "failed", message: "InsuInsufficient SOL balance" });
    // }
    // else{
    //   if(solBal < bXtip)
    //     return res
    //       .status(400)
    //       .json({ status: "failed", message: "InsuInsufficient SOL balance for tip" });
    //   const splBal = await getWalletBalance(mint, userKeypair.publicKey);
    //   if(splBal < inAmount)
    //     return res
    //     .status(400)
    //     .json({ status: "failed", message: "InsuInsufficient SPL token balance" });
    // }

    // // Check if the user has enough balance
    // const solBalance = await connection.getBalance(userKeypair.publicKey);
    // const _splBal = await getWalletBalance(mint, userKeypair.publicKey);
    // const tokenBalance = _splBal * 10 ** decimal;
    // if (isBuy) {
    //   const requireSOL = inAmount + bXtip + SYS_FEE;
    //   if (solBalance < requireSOL) {
    //     return res.status(400).json({
    //       status: "failed",
    //       message: "Balance not enough",
    //     });
    //   }
    // } else {
    //   const requireSOL = bXtip + SYS_FEE;
    //   if (solBalance < requireSOL || tokenBalance < inAmount) {
    //     return res.status(400).json({
    //       status: "failed",
    //       message: "Balance not enough",
    //     });
    //   }
    // }
    

    const inputTokenAmount = new TokenAmount(inputToken, inAmount);
    const walletTokenAccounts = await getWalletTokenAccount(
      connection,
      userKeypair.publicKey
    );
    const poolInfo = await getRaydiumInfo(mint);
    console.log('poolid', poolInfo.id);
    const targetPoolInfo = await formatAmmKeysById(poolInfo.id);
    if (!targetPoolInfo) {
      await sleep(100);
      return await swapRaydiumToken(req, res, isBuy);
    }
    const poolKeys = jsonInfo2PoolKeys(targetPoolInfo) as LiquidityPoolKeys;
    const minA = new TokenAmount(MINT_TOKEN, 1);

    // const { amountOut, minAmountOut } = Liquidity.computeAmountOut({
    //   poolKeys: poolKeys,
    //   poolInfo: await Liquidity.fetchInfo({ connection, poolKeys }),
    //   amountIn: inputTokenAmount,
    //   currencyOut: outputToken,
    //   slippage: slippageP,
    // });
    // -------- step 2: create instructions by SDK function --------
    const { innerTransactions } = await Liquidity.makeSwapInstructionSimple({
      connection,
      poolKeys,
      userKeys: {
        tokenAccounts: walletTokenAccounts,
        owner: userKeypair.publicKey,
      },
      amountIn: inputTokenAmount,
      amountOut: minA,
      fixedSide: "in",
      makeTxVersion: 0,
    });
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

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash();
    const messageV0 = new TransactionMessage({
      payerKey: userKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const txn = new VersionedTransaction(messageV0);
    txn.sign([userKeypair]);
    console.log("1");

    // We first simulate whether the transaction would be successful
    const { value: simulatedTransactionResponse } =
      await connection.simulateTransaction(txn, {
        replaceRecentBlockhash: true,
        commitment: "processed",
      });
    const { err, logs } = simulatedTransactionResponse;

    console.log("🚀 Simulate ~", Date.now());

    if (err) {
      console.error("Simulation Error:");
      console.error({ err, logs });
      return;
    }

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
          tokens: 0,
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

router.get("/price", getRaydiumTokenPrice)
// router.get("/", (req: Request, res: Response) => {
//   res.status(400).json({
//     status: "failed",
//     message: "Please send POST request to /buy or /sell",
//   });
// });

export default router;
