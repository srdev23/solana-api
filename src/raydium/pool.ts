import { Liquidity, LiquidityPoolKeysV4, MARKET_STATE_LAYOUT_V3, Market, TOKEN_PROGRAM_ID } from "@raydium-io/raydium-sdk";
import { Commitment, Connection, PublicKey } from "@solana/web3.js";
import fs from "fs";
import path from "path";
import { connection } from "../../config";

const LOG_FILE_PATH = path.resolve(__dirname, '..', '..', 'storage', 'logs.json'); // Adjusted to go two levels up
const LOG_DIR_PATH = path.resolve(__dirname, '..', '..', 'storage'); // Adjusted to go two levels up

export class PoolKeys {
    static SOLANA_ADDRESS = 'So11111111111111111111111111111111111111112';
    static RAYDIUM_POOL_V4_PROGRAM_ID = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
    static OPENBOOK_ADDRESS = 'srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX';
    static SOL_DECIMALS = 9;

    static async fetchMarketId(connection: Connection, baseMint: PublicKey, quoteMint: PublicKey, commitment: Commitment) {
        const accounts = await connection.getProgramAccounts(
            new PublicKey('srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX'),
            {
                commitment,
                filters: [
                    { dataSize: MARKET_STATE_LAYOUT_V3.span },
                    {
                        memcmp: {
                            offset: MARKET_STATE_LAYOUT_V3.offsetOf("baseMint"),
                            bytes: baseMint.toBase58(),
                        },
                    },
                    {
                        memcmp: {
                            offset: MARKET_STATE_LAYOUT_V3.offsetOf("quoteMint"),
                            bytes: quoteMint.toBase58(),
                        },
                    },
                ],
            }
        );
        return accounts.map(({ account }) => MARKET_STATE_LAYOUT_V3.decode(account.data))[0].ownAddress;
    }

    static async fetchMarketInfo(marketId: PublicKey) {
        const marketAccountInfo = await connection.getAccountInfo(marketId);
        if (!marketAccountInfo) {
            throw new Error('Failed to fetch market info for market id ' + marketId.toBase58());
        }

        return MARKET_STATE_LAYOUT_V3.decode(marketAccountInfo.data);
    }

    static async generateV4PoolInfo(baseMint: PublicKey, baseDecimals: number, quoteMint: PublicKey, marketID: PublicKey) {
        const poolInfo = Liquidity.getAssociatedPoolKeys({
            version: 4,
            marketVersion: 3,
            baseMint: baseMint,
            quoteMint: quoteMint,
            baseDecimals: 0,
            quoteDecimals: this.SOL_DECIMALS,
            programId: new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'),
            marketId: marketID,
            marketProgramId: new PublicKey('srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX'),
        });

        return { poolInfo };
    }

    static async fetchPoolKeyInfo(baseMint: PublicKey, quoteMint: PublicKey): Promise<LiquidityPoolKeysV4> {
        const cachedData = await this.readCache(baseMint.toBase58());
        if (cachedData) {
            return this.convertCacheToPoolKeys(cachedData);
        }

        const marketId = await this.fetchMarketId(connection, baseMint, quoteMint, 'confirmed');
        const marketInfo = await this.fetchMarketInfo(marketId);
        const baseMintInfo = await connection.getParsedAccountInfo(baseMint) as MintInfo;
        const baseDecimals = baseMintInfo.value.data.parsed.info.decimals;

        const V4PoolInfo = await this.generateV4PoolInfo(baseMint, baseDecimals, quoteMint, marketId);
        const lpMintInfo = await connection.getParsedAccountInfo(V4PoolInfo.poolInfo.lpMint) as MintInfo;

        const poolKeyInfo: LiquidityPoolKeysV4 = {
            id: V4PoolInfo.poolInfo.id,
            marketId: marketId,
            baseMint: baseMint,
            quoteMint: quoteMint,
            baseVault: V4PoolInfo.poolInfo.baseVault,
            quoteVault: V4PoolInfo.poolInfo.quoteVault,
            lpMint: V4PoolInfo.poolInfo.lpMint,
            baseDecimals: baseDecimals,
            quoteDecimals: this.SOL_DECIMALS,
            lpDecimals: lpMintInfo.value.data.parsed.info.decimals,
            version: 4 as 4,
            programId: new PublicKey(this.RAYDIUM_POOL_V4_PROGRAM_ID),
            authority: V4PoolInfo.poolInfo.authority,
            openOrders: V4PoolInfo.poolInfo.openOrders,
            targetOrders: V4PoolInfo.poolInfo.targetOrders,
            withdrawQueue: new PublicKey("11111111111111111111111111111111"),
            lpVault: new PublicKey("11111111111111111111111111111111"),
            marketVersion: 3,
            marketProgramId: new PublicKey(this.OPENBOOK_ADDRESS),
            marketAuthority: (await Market.getAssociatedAuthority({ programId: new PublicKey(this.OPENBOOK_ADDRESS), marketId: marketId })).publicKey,
            marketBaseVault: marketInfo.baseVault,
            marketQuoteVault: marketInfo.quoteVault,
            marketBids: marketInfo.bids,
            marketAsks: marketInfo.asks,
            marketEventQueue: marketInfo.eventQueue,
            lookupTableAccount: PublicKey.default
        };

        await this.writeCache(baseMint.toBase58(), poolKeyInfo);
        return poolKeyInfo;
    }

    static convertCacheToPoolKeys(data: any): LiquidityPoolKeysV4 {
        return {
            ...data,
            id: new PublicKey(data.id),
            marketId: new PublicKey(data.marketId),
            baseMint: new PublicKey(data.baseMint),
            quoteMint: new PublicKey(data.quoteMint),
            baseVault: new PublicKey(data.baseVault),
            quoteVault: new PublicKey(data.quoteVault),
            lpMint: new PublicKey(data.lpMint),
            programId: new PublicKey(data.programId),
            authority: new PublicKey(data.authority),
            openOrders: new PublicKey(data.openOrders),
            targetOrders: new PublicKey(data.targetOrders),
            withdrawQueue: new PublicKey(data.withdrawQueue),
            lpVault: new PublicKey(data.lpVault),
            marketProgramId: new PublicKey(data.marketProgramId),
            marketAuthority: new PublicKey(data.marketAuthority),
            marketBaseVault: new PublicKey(data.marketBaseVault),
            marketQuoteVault: new PublicKey(data.marketQuoteVault),
            marketBids: new PublicKey(data.marketBids),
            marketAsks: new PublicKey(data.marketAsks),
            marketEventQueue: new PublicKey(data.marketEventQueue),
            lookupTableAccount: new PublicKey(data.lookupTableAccount)
        };
    }

    static async readCache(baseMint: string): Promise<any> {
        if (!fs.existsSync(LOG_FILE_PATH)) {
            return null;
        }

        try {
            const data = await fs.promises.readFile(LOG_FILE_PATH, { encoding: 'utf-8' });
            if (!data) return null;

            const jsonData = JSON.parse(data);
            return jsonData[baseMint] || null;
        } catch (error) {
            console.error("Failed to read or parse cached data:", error);
            return null;
        }
    }

    static async writeCache(baseMint: string, data: LiquidityPoolKeysV4) {
        // Ensure the directory exists
        if (!fs.existsSync(LOG_DIR_PATH)) {
            await fs.promises.mkdir(LOG_DIR_PATH, { recursive: true });
        }

        let logData = {};
        if (fs.existsSync(LOG_FILE_PATH)) {
            try {
                const fileData = await fs.promises.readFile(LOG_FILE_PATH, { encoding: 'utf-8' });
                if (fileData) {
                    logData = JSON.parse(fileData);
                }
            } catch (error) {
                console.error("Failed to read existing log data:", error);
            }
        }

        logData[baseMint] = data;
        await fs.promises.writeFile(LOG_FILE_PATH, JSON.stringify(logData, null, 2));
    }
}

interface MintInfo {
    value: {
        data: {
            parsed: {
                info: {
                    decimals: number;
                };
            };
        };
    };
}