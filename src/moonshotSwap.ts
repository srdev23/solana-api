import { Router, Request, Response } from "express";
import { Moonshot, Environment } from "@wen-moon-ser/moonshot-sdk";
import {
  ComputeBudgetProgram,
  Keypair,
  TransactionMessage,
  VersionedTransaction,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import bs58 from "bs58";
import { logger } from "../logger"; // Adjust the path as necessary
import rateLimit from "express-rate-limit";

import {
  createTraderAPIMemoInstruction,
  HttpProvider,
  MAINNET_API_NY_HTTP,
} from "@bloxroute/solana-trader-client-ts";
import {
  AUTH_HEADER,
  BLOXROUT_RECEIVER,
  connection,
  RPC_URL,
  SYS_FEE,
  SYS_FEE_RECEIVER,
} from "../config";
import cors from "cors";
import { morganMiddleware } from "../logger";
import { getWalletBalance, retrieveEnvVariable } from "./utils";

const getMoonshotPrice = async (req: Request, res: Response) => {
  const moonshot = new Moonshot({
    rpcUrl: RPC_URL,
    authToken: "YOUR_AUTH_TOKEN",
    environment: Environment.MAINNET,
  });

  const mint = req.query.mint;
  if(!mint)
    return res.status(400).json({ error: "Mint address is required" });
  console.log(mint);
  const token = moonshot.Token({
    mintAddress: mint.toString(),
  });

  const curvePos = await token.getCurvePosition();
  const collateralPrice = await token.getCollateralPrice({
    tokenAmount: BigInt(1e9), // 1 token in minimal units
    curvePosition: curvePos,
  });
  const singleTokenPriceSol = Number(collateralPrice) / 1e9; // Convert lamports to SOL
  const SOL_USD_PRICE = retrieveEnvVariable("SOL_USD_PRICE");
  const priceInUSD = singleTokenPriceSol * Number(SOL_USD_PRICE);
  return res.status(200).json({
    priceInSOL: singleTokenPriceSol.toFixed(9),
    priceInUSD: priceInUSD.toFixed(9),
    
  })
}

const swapMoonShot = async (req: Request, res: Response, isBuy: boolean) => {
  const {
    private_key,
    mint,
    amount,
    microlamports,
    slippage,
    tip = 0.001,
  } = req.body;
  if (!private_key || !mint || !amount || !microlamports || !slippage)
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
  let userKeypair: Keypair;
  try{
    userKeypair = Keypair.fromSecretKey(bs58.decode(private_key));
  }catch(e){
    return res
      .status(400)
      .json({ status: "failed", message: "Invalid Private Key" });
  }
  try {
    logger.info(`Received request data: ${JSON.stringify(req.body)}`); // Log received data

    
    const moonshot = new Moonshot({
      rpcUrl: RPC_URL,
      authToken: "YOUR_AUTH_TOKEN",
      environment: Environment.MAINNET,
    });

    const token = moonshot.Token({
      mintAddress: mint,
    });

    const bXtip = tip * LAMPORTS_PER_SOL;
    const memo = createTraderAPIMemoInstruction("");

    const curvePos = await token.getCurvePosition();
    const collateralPrice = await token.getCollateralPrice({
      tokenAmount: BigInt(1e9), // 1 token in minimal units
      curvePosition: curvePos,
    });
    const singleTokenPriceSol = Number(collateralPrice) / 1e9; // Convert lamports to SOL
    // Specify the amount in SOL you want to spend
    const tokensToBuy = Math.floor(amount / singleTokenPriceSol);
    const splAmount = BigInt(isBuy ? tokensToBuy : amount) * BigInt(1e9); // Convert to minimal units


    const solBal = await connection.getBalance(userKeypair.publicKey)
    if(isBuy)
    {
      if(solBal < amount * LAMPORTS_PER_SOL + bXtip)
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
      if(splBal < splAmount)
        return res
        .status(400)
        .json({ status: "failed", message: "InsuInsufficient SPL token balance" });
    }
    // Calculate the price for a single token in SOL using the SDK
    const provider = new HttpProvider(
      AUTH_HEADER,
      private_key,
      MAINNET_API_NY_HTTP
    );    

    const collateralAmount = await token.getCollateralAmountByTokens({
      tokenAmount: splAmount,
      tradeDirection: isBuy ? "BUY" : "SELL",
    });

    const { ixs } = await token.prepareIxs({
      slippageBps: slippage,
      creatorPK: userKeypair.publicKey.toBase58(),
      tokenAmount: splAmount,
      collateralAmount,
      tradeDirection: isBuy ? "BUY" : "SELL",
    });

    const priorityIx = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: microlamports,
    });

    const feeTransferIx = SystemProgram.transfer({
      fromPubkey: userKeypair.publicKey,
      toPubkey: new PublicKey(SYS_FEE_RECEIVER),
      lamports: SYS_FEE,
    });

    const bloXroutTipIx = SystemProgram.transfer({
      fromPubkey: userKeypair.publicKey,
      toPubkey: BLOXROUT_RECEIVER,
      lamports: bXtip,
    });

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const messageV0 = new TransactionMessage({
      payerKey: userKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions: [priorityIx, ...ixs, feeTransferIx, bloXroutTipIx, memo],
    }).compileToV0Message();

    const txn = new VersionedTransaction(messageV0);

    txn.sign([userKeypair]);
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
      const SOL_USD_PRICE = retrieveEnvVariable("SOL_USD_PRICE");
      if (isBuy)
        return res.status(200).json({
          status: "success",
          tokens: tokensToBuy,
          usd: singleTokenPriceSol * parseFloat(SOL_USD_PRICE),
          txid: sig,
        });
      return res.status(200).json({
        status: "success",
        sol: Number(collateralAmount) / 1e9,
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
  swapMoonShot(req, res, true);
});

router.post("/sell", (req: Request, res: Response) => {
  swapMoonShot(req, res, false);
});

router.get("/price", getMoonshotPrice);

// Handle GET requests to show error for direct URL access
// router.get("/", (req: Request, res: Response) => {
//   res
//     .status(400)
//     .json({
//       status: "failed",
//       message: "Please send POST request to /buy or /sell",
//     });
// });

export default router;
