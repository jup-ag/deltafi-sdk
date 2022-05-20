import { token } from "@project-serum/anchor/dist/cjs/utils";
import { Token, TOKEN_PROGRAM_ID, u64 } from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import { getDeltafiDexV2, makeProvider } from "./anchor/anchor_utils";
import { DeltafiUser, SwapInfo } from "./anchor/type_definitions";
import {
  exponentiate,
  getMarketConfig,
  getProgramId,
  getTokenInfo,
  mergeTransactions,
  parsePoolInfoFromMintPair,
} from "./utils";
import { toBufferLE } from "bigint-buffer";
import { BN } from "@project-serum/anchor";

/**
 * PI that creates a deltafi swap transaction
 * @param walletPubkey
 * @param connection
 * @param inputTokenMintPubkey
 * @param outputTokenMintPubkey
 * @param inputTokenAccountPubkey
 * @param outputTokenAccountPubkey
 * @param inputAmount
 * @param minOutputAmount
 * @param deployment
 * @returns
 */
export async function createSwapTransaction(
  walletPubkey: PublicKey,
  connection: Connection,
  inputTokenMintPubkey: PublicKey,
  outputTokenMintPubkey: PublicKey,
  inputTokenAccountPubkey: PublicKey,
  outputTokenAccountPubkey: PublicKey,
  inputAmount: string,
  minOutputAmount: string = "0",
  deployment: string = "mainnet-prod",
): Promise<any> {
  const inputTokenDecimals = getTokenInfo(deployment, inputTokenMintPubkey.toBase58()).decimals;
  const inputAmountBigInt: bigint = BigInt(
    exponentiate(inputAmount, inputTokenDecimals).toFixed(0),
  );
  const minOutputAmountBigInt: bigint = BigInt(
    exponentiate(minOutputAmount, inputTokenDecimals).toFixed(0),
  );
  const poolPubkey: PublicKey = parsePoolInfoFromMintPair(
    deployment,
    inputTokenMintPubkey.toBase58(),
    outputTokenMintPubkey.toBase58(),
  );
  const program = getDeltafiDexV2(getProgramId(deployment), makeProvider(connection, {}));
  const swapInfo: SwapInfo = await program.account.swapInfo.fetch(poolPubkey);
  const marketConfig = getMarketConfig(deployment);

  const userTransferAuthority = Keypair.generate();
  const transactionApprove: Transaction = new Transaction();
  transactionApprove.add(
    Token.createApproveInstruction(
      TOKEN_PROGRAM_ID,
      inputTokenAccountPubkey,
      userTransferAuthority.publicKey,
      walletPubkey,
      [],
      u64.fromBuffer(toBufferLE(inputAmountBigInt, 8)),
    ),
  );

  const signers = [userTransferAuthority];

  const [deltafiUserPubkey, deltafiUserBump] = await PublicKey.findProgramAddress(
    [Buffer.from("User"), marketConfig.toBuffer(), walletPubkey.toBuffer()],
    program.programId,
  );

  const deltafiUser: DeltafiUser = await program.account.deltafiUser.fetchNullable(
    deltafiUserPubkey,
  );
  const transactionCreateDeltafiUser: Transaction | undefined = (() => {
    if (!deltafiUser) {
      return program.transaction.createDeltafiUser(deltafiUserBump, {
        accounts: {
          marketConfig,
          owner: walletPubkey,
          deltafiUser: deltafiUserPubkey,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        },
      });
    }
  })();

  const { swapSourceToken, swapDestinationToken, adminDestinationToken } = (() => {
    if (
      swapInfo.mintBase.toBase58() === inputTokenMintPubkey.toBase58() &&
      swapInfo.mintQuote.toBase58() === outputTokenMintPubkey.toBase58()
    ) {
      return {
        swapSourceToken: swapInfo.tokenBase,
        swapDestinationToken: swapInfo.tokenQuote,
        adminDestinationToken: swapInfo.adminFeeTokenQuote,
      };
    } else if (
      swapInfo.mintBase.toBase58() === outputTokenMintPubkey.toBase58() &&
      swapInfo.mintQuote.toBase58() === inputTokenMintPubkey.toBase58()
    ) {
      return {
        swapSourceToken: swapInfo.tokenQuote,
        swapDestinationToken: swapInfo.tokenBase,
        adminDestinationToken: swapInfo.adminFeeTokenBase,
      };
    }

    throw Error("Pools' token pair does not match the input token pair");
  })();

  const swapAccounts = {
    marketConfig: marketConfig,
    swapInfo: poolPubkey,
    userSourceToken: inputTokenAccountPubkey,
    userDestinationToken: outputTokenAccountPubkey,
    swapSourceToken,
    swapDestinationToken,
    deltafiUser: deltafiUserPubkey,
    adminDestinationToken,
    pythPriceBase: swapInfo.pythPriceBase,
    pythPriceQuote: swapInfo.pythPriceQuote,
    userAuthority: userTransferAuthority.publicKey,
    tokenProgram: token.TOKEN_PROGRAM_ID,
  };

  const transactionSwap: Transaction = (() => {
    if (swapInfo.swapType.normalSwap) {
      return program.transaction.normalSwap(
        new BN(inputAmountBigInt),
        new BN(minOutputAmountBigInt),
        {
          accounts: swapAccounts,
        },
      );
    } else if (swapInfo.swapType.stableSwap) {
      return program.transaction.stableSwap(
        new BN(inputAmountBigInt),
        new BN(minOutputAmountBigInt),
        {
          accounts: swapAccounts,
        },
      );
    }

    throw Error("Invalid swap type: " + swapInfo.swapType);
  })();

  const transaction = mergeTransactions([
    transactionApprove,
    transactionCreateDeltafiUser,
    transactionSwap,
  ]);
  transaction.recentBlockhash = (await connection.getLatestBlockhash("max")).blockhash;
  transaction.feePayer = walletPubkey;

  return { transaction, userTransferAuthority };
}
