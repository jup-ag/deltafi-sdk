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
import { getDeltafiDexV2, makeProvider } from "../anchor/anchor_utils";
import { DeltafiUser, SwapInfo } from "../anchor/type_definitions";
import { exponentiate, mergeTransactions } from "./utils";
import { toBufferLE } from "bigint-buffer";
import { web3, BN } from "@project-serum/anchor";
import { AccountLayout } from "@solana/spl-token";

/**
 * the API function that creates a deltafi swap transaction
 * we assume that the input parameters are correct, that that mints match the token accounts and token accounts' owner is the wallet pubkey
 * if the input is not correct, the transaction will fail
 * this API only handles the swaps between 2 spl-tokens, it doesn't handle the native SOL swap
 * @param {PublicKey} walletPubkey the public key of the user's wallet
 * @param {Connection} connection the web3 connection for rpc calls
 * @param {PublicKey} inputTokenAccountPubkey token account of the input(selling) token, the owner must be walletPubkey
 * @param {PublicKey} outputTokenAccountPubkey token account of the output(buying) token, the owner must be walletPubkey
 * @param {string} inputAmount amount of the input token to be sold
 * @param {string} minOutputAmount minimum amout of the output token to get, common practice to prevent high slippage. It is 0 by defaul
 * @returns { transaction, userTransferAuthority } generated transaction and a temporary authority keypair. userTransferAuthority must be used for signing the transaction
 */
export async function createSwapTransaction(
  walletPubkey: PublicKey,
  connection: Connection,
  inputTokenAccountPubkey: PublicKey,
  outputTokenAccountPubkey: PublicKey,
  inputAmount: string,
  minOutputAmount: string = "0",
  deployConfig,
  poolConfig,
  inputTokenConfig,
  outputTokenConfig,
): Promise<any> {
  const inputTokenDecimals = inputTokenConfig.decimals;
  const inputAmountBigInt: bigint = BigInt(
    exponentiate(inputAmount, inputTokenDecimals).toFixed(0),
  );
  const minOutputAmountBigInt: bigint = BigInt(
    exponentiate(minOutputAmount, inputTokenDecimals).toFixed(0),
  );
  const program = getDeltafiDexV2(
    new PublicKey(deployConfig.programId),
    makeProvider(connection, {}),
  );
  const poolPubkey = new PublicKey(poolConfig.swapInfo);
  const swapInfo: SwapInfo = await program.account.swapInfo.fetch(poolPubkey);
  const marketConfig = new PublicKey(deployConfig.marketConfig);

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
      swapInfo.mintBase.toBase58() === inputTokenConfig.mint &&
      swapInfo.mintQuote.toBase58() === outputTokenConfig.mint
    ) {
      return {
        swapSourceToken: swapInfo.tokenBase,
        swapDestinationToken: swapInfo.tokenQuote,
        adminDestinationToken: swapInfo.adminFeeTokenQuote,
      };
    } else if (
      swapInfo.mintBase.toBase58() === outputTokenConfig.mint &&
      swapInfo.mintQuote.toBase58() === inputTokenConfig.mint
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

export async function createDepositTransaction(
  program: any,
  connection: Connection,
  poolConfig: any,
  swapInfo: any,
  userTokenBase: PublicKey,
  userTokenQuote: PublicKey,
  walletPubkey: PublicKey,
  lpUser: any,
  baseAmount: BN,
  quoteAmount: BN,
) {
  let baseSourceRef = userTokenBase;
  let quoteSourceRef = userTokenQuote;

  const [lpPublicKey, lpBump] = await PublicKey.findProgramAddress(
    [
      Buffer.from("LiquidityProvider"),
      new PublicKey(poolConfig.swapInfo).toBuffer(),
      walletPubkey.toBuffer(),
    ],
    program.programId,
  );

  const userTransferAuthority = Keypair.generate();
  let transaction = new Transaction();
  transaction
    .add(
      Token.createApproveInstruction(
        TOKEN_PROGRAM_ID,
        baseSourceRef,
        userTransferAuthority.publicKey,
        walletPubkey,
        [],
        u64.fromBuffer(toBufferLE(BigInt(baseAmount.toString()), 8)),
      ),
    )
    .add(
      Token.createApproveInstruction(
        TOKEN_PROGRAM_ID,
        quoteSourceRef,
        userTransferAuthority.publicKey,
        walletPubkey,
        [],
        u64.fromBuffer(toBufferLE(BigInt(quoteAmount.toString()), 8)),
      ),
    );

  const depositAccounts = {
    swapInfo: new PublicKey(poolConfig.swapInfo),
    userTokenBase: baseSourceRef,
    userTokenQuote,
    quoteSourceRef,
    liquidityProvider: lpPublicKey,
    tokenBase: swapInfo.tokenBase,
    tokenQuote: swapInfo.tokenQuote,
    pythPriceBase: swapInfo.pythPriceBase,
    pythPriceQuote: swapInfo.pythPriceQuote,
    userAuthority: userTransferAuthority.publicKey,
    tokenProgram: token.TOKEN_PROGRAM_ID,
  };

  if (swapInfo.swapType.stableSwap) {
    transaction.add(
      program.transaction.depositToStableSwap(baseAmount, quoteAmount, new BN(0), new BN(0), {
        accounts: depositAccounts,
      }),
    );
  } else {
    transaction.add(
      program.transaction.depositToNormalSwap(baseAmount, quoteAmount, new BN(0), new BN(0), {
        accounts: depositAccounts,
      }),
    );
  }

  if (lpUser === null) {
    const createLpTransaction = program.transaction.createLiquidityProvider(lpBump, {
      accounts: {
        marketConfig: swapInfo.configKey,
        swapInfo: new PublicKey(poolConfig.swapInfo),
        liquidityProvider: lpPublicKey,
        owner: walletPubkey,
        systemProgram: web3.SystemProgram.programId,
        rent: web3.SYSVAR_RENT_PUBKEY,
      },
    });
    transaction = mergeTransactions([createLpTransaction, transaction]);
  }

  transaction.recentBlockhash = (await connection.getLatestBlockhash("max")).blockhash;
  transaction.feePayer = walletPubkey;

  return { transaction, userTransferAuthority };
}

export async function createWithdrawTransaction(
  program: any,
  connection: Connection,
  poolConfig: any,
  swapInfo: any,
  userTokenBase: PublicKey,
  userTokenQuote: PublicKey,
  walletPubkey: PublicKey,
  baseShare: BN,
  quoteShare: BN,
) {
  let baseSourceRef = userTokenBase;
  let quoteSourceRef = userTokenQuote;

  const [lpPublicKey] = await PublicKey.findProgramAddress(
    [
      Buffer.from("LiquidityProvider"),
      new PublicKey(poolConfig.swapInfo).toBuffer(),
      walletPubkey.toBuffer(),
    ],
    program.programId,
  );

  let transaction = new Transaction();
  const withdrawAccounts = {
    swapInfo: new PublicKey(poolConfig.swapInfo),
    userTokenBase: baseSourceRef,
    userTokenQuote,
    quoteSourceRef,
    liquidityProvider: lpPublicKey,
    tokenBase: swapInfo.tokenBase,
    tokenQuote: swapInfo.tokenQuote,
    adminFeeTokenBase: swapInfo.adminFeeTokenBase,
    adminFeeTokenQuote: swapInfo.adminFeeTokenQuote,
    pythPriceBase: swapInfo.pythPriceBase,
    pythPriceQuote: swapInfo.pythPriceQuote,
    userAuthority: walletPubkey,
    tokenProgram: token.TOKEN_PROGRAM_ID,
  };
  if (swapInfo.swapType.stableSwap) {
    transaction.add(
      program.transaction.withdrawFromStableSwap(baseShare, quoteShare, new BN(0), new BN(0), {
        accounts: withdrawAccounts,
      }),
    );
  } else {
    transaction.add(
      program.transaction.withdrawFromNormalSwap(baseShare, quoteShare, new BN(0), new BN(0), {
        accounts: withdrawAccounts,
      }),
    );
  }

  transaction.recentBlockhash = (await connection.getLatestBlockhash("max")).blockhash;
  transaction.feePayer = walletPubkey;

  return transaction;
}
