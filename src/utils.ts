import rateLimit from "express-rate-limit";
import {
  SPL_ACCOUNT_LAYOUT,
  TOKEN_PROGRAM_ID,
  TokenAccount,
} from "@raydium-io/raydium-sdk";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { Connection } from "@solana/web3.js";
import { connection } from "../config";
import axios from "axios";

import dotenv from 'dotenv'
dotenv.config()

export const retrieveEnvVariable = (variableName: string) => {
  const variable = process.env[variableName] || ''
  if (!variable) {
    console.log(`${variableName} is not set`)
    process.exit(1)
  }
  return variable
}

export async function getCoinData(mintStr: string) {
  try {
    const url = `https://frontend-api.pump.fun/coins/${mintStr}`;
    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        Referer: "https://www.pump.fun/",
        Origin: "https://www.pump.fun",
        Connection: "keep-alive",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "cross-site",
        "If-None-Match": 'W/"43a-tWaCcS4XujSi30IFlxDCJYxkMKg"',
      },
    });
    if (response.status === 200) {
      return response.data;
    } else {
      console.error("Failed to retrieve coin data:", response.status);
      return null;
    }
  } catch (error) {
    console.error("Error fetching coin data:", error);
    return null;
  }
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getRaydiumInfo(mint: string) {
  try{
    const endpoint = `https://api-v3.raydium.io/pools/info/mint?mint1=${mint}&mint2=So11111111111111111111111111111111111111112&poolType=standard&poolSortField=default&sortType=desc&pageSize=1&page=1`;
    const res = await fetch(endpoint);
    if (res.status !== 200) {
      await sleep(100);
      return await getRaydiumInfo(mint);
    }
    const jsonData = await res.json();
    return jsonData.data.data[0];
  }catch(e){
    console.log('getting rayidum pool data', e);
    await sleep(1000);
    return await getRaydiumInfo(mint);
  }
}

export async function getWalletTokenAccount(
  connection: Connection,
  wallet: PublicKey
): Promise<TokenAccount[]> {
  const walletTokenAccount = await connection.getTokenAccountsByOwner(wallet, {
    programId: TOKEN_PROGRAM_ID,
  });
  return walletTokenAccount.value.map((i) => ({
    pubkey: i.pubkey,
    programId: i.account.owner,
    accountInfo: SPL_ACCOUNT_LAYOUT.decode(i.account.data),
  }));
}

export const getWalletBalance = async (
  mint: string,
  owner: PublicKey
): Promise<number> => {
  try {
    const ata = getAssociatedTokenAddressSync(
      new PublicKey(mint),
      owner,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const balance = await connection.getTokenAccountBalance(ata);
    // console.log(balance.value.uiAmount)
    return Number(balance.value.uiAmount);
  } catch (e) {
    return 0;
  }
};
export function bufferFromUInt64(value: number | string) {
  let buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

export const limiter = rateLimit({
  windowMs: 1000, // 1 second
  max: 10, // Limit each IP to 10 requests per second
  message: {
    status: "failed",
    message: "Too many requests, please try again later.",
  },
});
