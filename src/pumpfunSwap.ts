import {
  ComputeBudgetProgram,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
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
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
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
import { getPumpTokenPriceInSol } from "./pump.price";

const pumpTokenPrice = async (req: Request, res: Response) => {
  const mint = req.query.mint;
  if(!mint)
    return res.status(400).json({ error: "Mint address is required" });
  console.log(mint);
  const { bondingCurve } = await getPumpData(new PublicKey(mint));
  const priceInSOL = await getPumpTokenPriceInSol(bondingCurve.toString())
  res.status(200).json({ 
    priceInSOL: priceInSOL.toFixed(9),
    priceInUSD: priceInSOL.toFixed(9) 
  });
}

function bufferFromUInt64(value: number | string) {
  let buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

function readBigUintLE(
  buf: Buffer,
  offset: number,
  length: number
): number {
  switch (length) {
    case 1:
      return buf.readUint8(offset);
    case 2:
      return buf.readUint16LE(offset);
    case 4:
      return buf.readUint32LE(offset);
    case 8:
      return Number(buf.readBigUint64LE(offset));
  }
  throw new Error(`unsupported data size (${length} bytes)`);
}

async function getPumpData(mint: PublicKey): Promise<{ bondingCurve: PublicKey, associatedBondingCurve: PublicKey, virtualTokenReserves: number, virtualSolReserves: number }> {
  console.log("\n- Getting pump data...");
  const mint_account = mint.toBuffer();
  const [bondingCurve] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mint_account],
    PUMP_FUN_PROGRAM
  );
  const [associatedBondingCurve] = PublicKey.findProgramAddressSync(
    [
      bondingCurve.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      this.mint.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const PUMP_CURVE_STATE_OFFSETS = {
    VIRTUAL_TOKEN_RESERVES: 0x08,
    VIRTUAL_SOL_RESERVES: 0x10,
  };

  const response = await connection.getAccountInfo(bondingCurve);
  if (response === null) throw new Error("curve account not found");
  const virtualTokenReserves = readBigUintLE(
    response.data,
    PUMP_CURVE_STATE_OFFSETS.VIRTUAL_TOKEN_RESERVES,
    8
  );
  const virtualSolReserves = readBigUintLE(
    response.data,
    PUMP_CURVE_STATE_OFFSETS.VIRTUAL_SOL_RESERVES,
    8
  );

  return { bondingCurve, associatedBondingCurve, virtualTokenReserves, virtualSolReserves };
}

const swapPumpToken = async (req: Request, res: Response, isBuy: boolean) => {
  const {
    private_key,
    mint,
    amount,
    microlamports,
    units,
    slippage,
  } = req.body;
  if (!private_key || !mint || !amount || !microlamports || !units || !slippage)
    return res
      .status(400)
      .json({ status: "failed", message: "Missing required parameters" });

  try {
    logger.info(`Received request data: ${JSON.stringify(req.body)}`);

    const pumpTokenData = await getPumpData(new PublicKey(mint));
    const txBuilder = new Transaction();
    const userKeypair = Keypair.fromSecretKey(bs58.decode(private_key));

    const mintAddress = new PublicKey(mint);
    const slippageValue = slippage / 100;

    const mintInfo = await getMint(connection, mintAddress);
    const decimal = mintInfo.decimals;

    const inDecimal = isBuy ? 9 : decimal;
    const outDecimal = isBuy ? decimal : 9;
    const inAmount = Math.ceil(amount * 10 ** inDecimal);

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
        pubkey: pumpTokenData.bondingCurve,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: pumpTokenData.associatedBondingCurve,
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
    let tokenOut;
    if (isBuy) {
      tokenOut = Math.floor(
        (inAmount * pumpTokenData.virtualTokenReserves /
          pumpTokenData.virtualSolReserves)
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
        (inAmount * (1 - slippageValue) * pumpTokenData.virtualSolReserves /
        pumpTokenData.virtualTokenReserves)
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
            toPubkey: SYS_FEE_RECEIVER,
            lamports: SYS_FEE,
          }),
          createCloseAccountInstruction(
            tokenAccountIn,
            userKeypair.publicKey,
            userKeypair.publicKey
          ),
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
            toPubkey: SYS_FEE_RECEIVER,
            lamports: SYS_FEE,
          }),
          createCloseAccountInstruction(
            tokenAccountOut,
            userKeypair.publicKey,
            userKeypair.publicKey
          ),
        ];

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash();

    const transaction = new Transaction().add(...instructions);
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = userKeypair.publicKey;

    const sig = await sendAndConfirmTransaction(connection, transaction, [userKeypair], { skipPreflight: true, preflightCommitment: 'processed' });

    console.log(
      `✅ Txn placed successfully\nSignature: https://solscan.io/tx/${sig}`
    );

    const confirmation = await connection.confirmTransaction({
      signature: sig,
      lastValidBlockHeight: lastValidBlockHeight,
      blockhash: blockhash,
    }, "processed");

    if (confirmation.value.err) {
      console.log("fail");
      return res.status(500).json({
        status: "failed",
        txid: sig,
        message: "Transaction confirmation error",
      });
    } else {
      console.log("success");
      if(isBuy)
        return res.status(200).json({
          status: "success",
          tokens: tokenOut / 10 ** outDecimal,
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
  swapPumpToken(req, res, true);
});
router.post("/sell", (req: Request, res: Response) => {
  swapPumpToken(req, res, false);
});

router.get("/price", pumpTokenPrice)

export default router;