import {
  ComputeBudgetProgram,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  getMint,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  createCloseAccountInstruction,
} from "@solana/spl-token";
import { bufferFromUInt64, getCoinData, getWalletBalance } from "./utils";
import {
  GLOBAL,
  FEE_RECIPIENT,
  SYSTEM_PROGRAM_ID,
  RENT,
  PUMP_FUN_ACCOUNT,
  PUMP_FUN_PROGRAM,
  ASSOC_TOKEN_ACC_PROG,
} from "./constants";

import {
  createTraderAPIMemoInstruction,
  HttpProvider,
  MAINNET_API_NY_HTTP,
} from "@bloxroute/solana-trader-client-ts";
import {
  AUTH_HEADER,
  BLOXROUT_RECEIVER,
  connection,
  SYS_FEE,
  SYS_FEE_RECEIVER,
} from "../config";
import { logger } from "../logger";
import { Request, Response, Router } from "express";
import bs58 from "bs58";
import rateLimit from "express-rate-limit";
import cors from "cors";
import { morganMiddleware } from "../logger";

const pumpTokenPrice = async (req: Request, res: Response) => {
  const mint = req.query.mint;
  if(!mint)
    return res.status(400).json({ error: "Mint address is required" });
  console.log(mint);
  const coinData = await getCoinData(mint.toString());
  if (!coinData) {
    console.error("Failed to retrieve coin data...");
    return res.status(400).json({ error: "Invalid mint address" });
  }
  const priceInSOL = coinData["market_cap"] / coinData["total_supply"] * 10 ** 6;
  const priceInUSD = coinData["usd_market_cap"] / coinData["total_supply"] * 10 ** 6;
  res.status(200).json({ 
    priceInSOL: priceInSOL.toFixed(9),
    priceInUSD: priceInUSD.toFixed(9) 
  });
}

const swapPumpToken = async (req: Request, res: Response, isBuy: boolean) => {
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
    logger.info(`Received request data: ${JSON.stringify(req.body)}`); // Log received data

    const coinData = await getCoinData(mint);
    if (!coinData) {
      console.error("Failed to retrieve coin data...");
      return;
    }

    const txBuilder = new Transaction();

    const provider = new HttpProvider(
      AUTH_HEADER,
      private_key,
      MAINNET_API_NY_HTTP
    );
    let userKeypair: Keypair;
    try{
      userKeypair = Keypair.fromSecretKey(bs58.decode(private_key));
    }catch(e){
      return res
        .status(400)
        .json({ status: "failed", message: "Invalid Private Key" });
    }
    const bXtip = tip * LAMPORTS_PER_SOL;
    const memo = createTraderAPIMemoInstruction("");

    const mintAddress = new PublicKey(mint);
    const slippageValue = slippage / 100;

    const mintInfo = await getMint(connection, mintAddress);
    const decimal = mintInfo.decimals;

    const inDecimal = isBuy ? 9 : decimal;
    const inAmount = amount * 10 ** inDecimal;

    const solBal = await connection.getBalance(userKeypair.publicKey)
    if(isBuy)
    {
      if(solBal < inAmount + bXtip)
        return res
          .status(400)
          .json({ status: "failed", message: "InsuInsufficient SOL balance" });
    }
    else{
      if(solBal < bXtip)
        return res
          .status(400)
          .json({ status: "failed", message: "InsuInsufficient SOL balance for tip" });
      const splBal = await getWalletBalance(mint, userKeypair.publicKey);
      if(splBal < inAmount)
        return res
        .status(400)
        .json({ status: "failed", message: "InsuInsufficient SPL token balance" });
    }

    const tokenAccountIn = getAssociatedTokenAddressSync(
      isBuy ? NATIVE_MINT : mintAddress,
      userKeypair.publicKey,
      true
    );
    const tokenAccountOut = getAssociatedTokenAddressSync(
      isBuy ? mintAddress : NATIVE_MINT,
      userKeypair.publicKey,
      true
    );

    const tokenAccountAddress = await getAssociatedTokenAddress(
      mintAddress,
      userKeypair.publicKey,
      false
    );
    const keys = [
      { pubkey: GLOBAL, isSigner: false, isWritable: false },
      { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: true },
      { pubkey: mintAddress, isSigner: false, isWritable: false },
      {
        pubkey: new PublicKey(coinData["bonding_curve"]),
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: new PublicKey(coinData["associated_bonding_curve"]),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: tokenAccountAddress, isSigner: false, isWritable: true },
      { pubkey: userKeypair.publicKey, isSigner: false, isWritable: true },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      {
        pubkey: isBuy ? TOKEN_PROGRAM_ID : ASSOC_TOKEN_ACC_PROG,
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: isBuy ? RENT : TOKEN_PROGRAM_ID,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: PUMP_FUN_ACCOUNT, isSigner: false, isWritable: false },
      { pubkey: PUMP_FUN_PROGRAM, isSigner: false, isWritable: false },
    ];

    let data: Buffer;

    if (isBuy) {
      const tokenOut = Math.floor(
        (inAmount * coinData["virtual_token_reserves"]) /
          coinData["virtual_sol_reserves"]
      );
      const solInWithSlippage = amount * (1 + slippageValue);
      const maxSolCost = Math.floor(solInWithSlippage * LAMPORTS_PER_SOL);

      data = Buffer.concat([
        bufferFromUInt64("16927863322537952870"),
        bufferFromUInt64(tokenOut),
        bufferFromUInt64(maxSolCost),
      ]);
    } else {
      const minSolOutput = Math.floor(
        (inAmount! * (1 - slippageValue) * coinData["virtual_sol_reserves"]) /
          coinData["virtual_token_reserves"]
      );
      data = Buffer.concat([
        bufferFromUInt64("12502976635542562355"),
        bufferFromUInt64(inAmount),
        bufferFromUInt64(minSolOutput),
      ]);
    }

    const instruction = new TransactionInstruction({
      keys: keys,
      programId: PUMP_FUN_PROGRAM,
      data: data,
    });
    txBuilder.add(instruction);

    const pumpInstruction = txBuilder.instructions;
    console.log("isBuy", isBuy);
    const instructions: TransactionInstruction[] = isBuy
      ? [
          ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: microlamports,
          }),
          ComputeBudgetProgram.setComputeUnitLimit({ units: units }),
          createAssociatedTokenAccountIdempotentInstruction(
            userKeypair.publicKey,
            tokenAccountIn,
            userKeypair.publicKey,
            NATIVE_MINT
          ),
          SystemProgram.transfer({
            fromPubkey: userKeypair.publicKey,
            toPubkey: tokenAccountIn,
            lamports: inAmount,
          }),
          createSyncNativeInstruction(tokenAccountIn, TOKEN_PROGRAM_ID),
          createAssociatedTokenAccountIdempotentInstruction(
            userKeypair.publicKey,
            tokenAccountOut,
            userKeypair.publicKey,
            new PublicKey(mint)
          ),
          ...pumpInstruction,
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
          createCloseAccountInstruction(
            tokenAccountIn,
            userKeypair.publicKey,
            userKeypair.publicKey
          ),
          memo,
        ]
      : [
          ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: microlamports,
          }),
          ComputeBudgetProgram.setComputeUnitLimit({ units: units }),
          createAssociatedTokenAccountIdempotentInstruction(
            userKeypair.publicKey,
            tokenAccountOut,
            userKeypair.publicKey,
            NATIVE_MINT
          ),
          ...pumpInstruction,
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
          createCloseAccountInstruction(
            tokenAccountOut,
            userKeypair.publicKey,
            userKeypair.publicKey
          ),
          memo,
        ];

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash();

    const messageV0 = new TransactionMessage({
      payerKey: userKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const txn = new VersionedTransaction(messageV0);
    // transaction.sign([wallet]);
    txn.sign([userKeypair]);
    // Sign the transaction
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
  swapPumpToken(req, res, true);
});
router.post("/sell", (req: Request, res: Response) => {
  swapPumpToken(req, res, false);
});

router.get("/price", pumpTokenPrice)
// router.get("/", (req, res) => {
//   res.status(400).json({
//     status: "failed",
//     message: "Please send POST request to /buy or /sell",
//   });
// });

export default router;
