import { token } from "@project-serum/anchor/dist/cjs/utils";
import { AccountLayout, NATIVE_MINT, Token, TOKEN_PROGRAM_ID, u64 } from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import { DeltafiUser, SwapInfo, SwapDirection } from "./type_definitions";
import { toBufferLE } from "bigint-buffer";
import { BN, web3 } from "@project-serum/anchor";

export function mergeTransactions(transactions: (Transaction | undefined)[]) {
  const transaction = new Transaction();
  transactions
    .filter((t): t is Transaction => !!t)
    .forEach((t) => {
      transaction.add(t);
    });
  return transaction;
}

export async function getDeltafiUser(program, marketConfig, walletPubkey) {
  const [deltafiUserPubkey] = await PublicKey.findProgramAddress(
    [Buffer.from("User"), marketConfig.toBuffer(), walletPubkey.toBuffer()],
    program.programId,
  );
  return program.account.deltafiUser.fetchNullable(deltafiUserPubkey);
}

export function createWrapSOLTransactions(
  wrapAccountPubkey: PublicKey,
  lamports: number,
  walletPubkey: PublicKey,
): {
  createWrappedTokenAccountTransaction: Transaction;
  initializeWrappedTokenAccountTransaction: Transaction;
  closeWrappedTokenAccountTransaction: Transaction;
} {
  const createWrappedTokenAccountTransaction = new Transaction();
  createWrappedTokenAccountTransaction.add(
    SystemProgram.createAccount({
      fromPubkey: walletPubkey,
      newAccountPubkey: wrapAccountPubkey,
      lamports,
      space: AccountLayout.span,
      programId: TOKEN_PROGRAM_ID,
    }),
  );

  const initializeWrappedTokenAccountTransaction = new Transaction();
  initializeWrappedTokenAccountTransaction.add(
    Token.createInitAccountInstruction(
      TOKEN_PROGRAM_ID,
      NATIVE_MINT,
      wrapAccountPubkey,
      walletPubkey,
    ),
  );

  const closeWrappedTokenAccountTransaction = new Transaction();
  closeWrappedTokenAccountTransaction.add(
    Token.createCloseAccountInstruction(
      TOKEN_PROGRAM_ID,
      wrapAccountPubkey,
      walletPubkey,
      walletPubkey,
      [],
    ),
  );

  return {
    createWrappedTokenAccountTransaction,
    initializeWrappedTokenAccountTransaction,
    closeWrappedTokenAccountTransaction,
  };
}

export async function createSwapTransaction(
  poolConfig: any,
  program: any,
  swapInfo: SwapInfo,
  deltafiUser: DeltafiUser,
  walletPubkey: PublicKey,
  inputTokenPubkey: PublicKey,
  outputTokenPubkey: PublicKey,
  inputAmount: BN,
  minOutputAmount: BN,
  swapDirection: SwapDirection,
): Promise<any> {
  const poolPubkey = new PublicKey(poolConfig.swapInfo);
  const marketConfig = swapInfo.configKey;

  const buySol =
    (poolConfig.quote === "SOL" && swapDirection.sellBase) ||
    (poolConfig.base === "SOL" && swapDirection.sellQuote);
  const sellSol =
    (poolConfig.quote === "SOL" && swapDirection.sellQuote) ||
    (poolConfig.base === "SOL" && swapDirection.sellBase);

  let userSourceTokenRef = inputTokenPubkey;
  let userDestinationTokenRef = outputTokenPubkey;

  const wrappedSolRefKeyPair = Keypair.generate();
  const createTokenAccountCost =
    await program.provider.connection.getMinimumBalanceForRentExemption(AccountLayout.span);
  let nativeSOLHandlingTransactions = null;
  if (buySol || sellSol) {
    const wrappedSOLLamport = buySol
      ? createTokenAccountCost
      : inputAmount.toNumber() + createTokenAccountCost;

    nativeSOLHandlingTransactions = createWrapSOLTransactions(
      wrappedSolRefKeyPair.publicKey,
      wrappedSOLLamport,
      walletPubkey,
    );

    if (buySol) {
      userDestinationTokenRef = wrappedSolRefKeyPair.publicKey;
    } else {
      userSourceTokenRef = wrappedSolRefKeyPair.publicKey;
    }
  }

  const userTransferAuthority = Keypair.generate();
  const transactionApprove: Transaction = new Transaction();
  transactionApprove.add(
    Token.createApproveInstruction(
      TOKEN_PROGRAM_ID,
      userSourceTokenRef,
      userTransferAuthority.publicKey,
      walletPubkey,
      [],
      u64.fromBuffer(toBufferLE(BigInt(inputAmount.toString()), 8)),
    ),
  );

  const [deltafiUserPubkey, deltafiUserBump] = await PublicKey.findProgramAddress(
    [Buffer.from("User"), marketConfig.toBuffer(), walletPubkey.toBuffer()],
    program.programId,
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
    if (swapDirection.sellBase) {
      return {
        swapSourceToken: swapInfo.tokenBase,
        swapDestinationToken: swapInfo.tokenQuote,
        adminDestinationToken: swapInfo.adminFeeTokenQuote,
      };
    } else if (swapDirection.sellQuote) {
      return {
        swapSourceToken: swapInfo.tokenQuote,
        swapDestinationToken: swapInfo.tokenBase,
        adminDestinationToken: swapInfo.adminFeeTokenBase,
      };
    }

    throw Error("Invalid swap direction: " + swapDirection);
  })();

  const swapAccounts = {
    marketConfig: marketConfig,
    swapInfo: poolPubkey,
    userSourceToken: userSourceTokenRef,
    userDestinationToken: userDestinationTokenRef,
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
      return program.transaction.normalSwap(inputAmount, minOutputAmount, {
        accounts: swapAccounts,
      });
    } else if (swapInfo.swapType.stableSwap) {
      return program.transaction.stableSwap(inputAmount, minOutputAmount, {
        accounts: swapAccounts,
      });
    }

    throw Error("Invalid swap type: " + swapInfo.swapType);
  })();

  let transaction = mergeTransactions([
    transactionApprove,
    transactionCreateDeltafiUser,
    transactionSwap,
  ]);

  const signers = [userTransferAuthority];
  if (buySol || sellSol) {
    const {
      createWrappedTokenAccountTransaction,
      initializeWrappedTokenAccountTransaction,
      closeWrappedTokenAccountTransaction,
    } = nativeSOLHandlingTransactions;
    transaction = mergeTransactions([
      createWrappedTokenAccountTransaction,
      initializeWrappedTokenAccountTransaction,
      transaction,
      closeWrappedTokenAccountTransaction,
    ]);
    signers.push(wrappedSolRefKeyPair);
  }

  return { transaction, signers };
}

export async function createDepositTransaction(
  poolConfig: any,
  program: any,
  swapInfo: any,
  userTokenBase: PublicKey,
  userTokenQuote: PublicKey,
  walletPubkey: PublicKey,
  lpUser: any,
  baseAmount: BN,
  quoteAmount: BN,
  minBaseShare: BN,
  minQuoteShare: BN,
) {
  let baseSourceRef = userTokenBase;
  let quoteSourceRef = userTokenQuote;

  const baseSOL = poolConfig.base === "SOL";
  const quoteSOL = poolConfig.quote === "SOL";
  const wrappedSolRefKeyPair = Keypair.generate();
  let nativeSOLHandlingTransactions = null;
  if (baseSOL || quoteSOL) {
    const rentLamports = await program.provider.connection.getMinimumBalanceForRentExemption(
      AccountLayout.span,
    );
    const wrappedSOLLamport =
      (baseSOL ? baseAmount.toNumber() : quoteAmount.toNumber()) + rentLamports;

    nativeSOLHandlingTransactions = createWrapSOLTransactions(
      wrappedSolRefKeyPair.publicKey,
      wrappedSOLLamport,
      walletPubkey,
    );

    if (baseSOL) {
      baseSourceRef = wrappedSolRefKeyPair.publicKey;
    } else {
      quoteSourceRef = wrappedSolRefKeyPair.publicKey;
    }
  }

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
    userTokenQuote: quoteSourceRef,
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
      program.transaction.depositToStableSwap(
        baseAmount,
        quoteAmount,
        minBaseShare,
        minQuoteShare,
        {
          accounts: depositAccounts,
        },
      ),
    );
  } else {
    transaction.add(
      program.transaction.depositToNormalSwap(
        baseAmount,
        quoteAmount,
        minBaseShare,
        minQuoteShare,
        {
          accounts: depositAccounts,
        },
      ),
    );
  }

  if (lpUser === null) {
    const createLpTransaction = program.transaction.createLiquidityProviderV2(lpBump, {
      accounts: {
        marketConfig: swapInfo.configKey,
        swapInfo: new PublicKey(poolConfig.swapInfo),
        liquidityProvider: lpPublicKey,
        owner: walletPubkey,
        payer: walletPubkey,
        systemProgram: web3.SystemProgram.programId,
        rent: web3.SYSVAR_RENT_PUBKEY,
      },
    });
    transaction = mergeTransactions([createLpTransaction, transaction]);
  }

  const signers = [userTransferAuthority];
  if (baseSOL || quoteSOL) {
    const {
      createWrappedTokenAccountTransaction,
      initializeWrappedTokenAccountTransaction,
      closeWrappedTokenAccountTransaction,
    } = nativeSOLHandlingTransactions;
    transaction = mergeTransactions([
      createWrappedTokenAccountTransaction,
      initializeWrappedTokenAccountTransaction,
      transaction,
      closeWrappedTokenAccountTransaction,
    ]);
    signers.push(wrappedSolRefKeyPair);
  }

  return { transaction, signers };
}

export async function createWithdrawTransaction(
  poolConfig: any,
  program: any,
  swapInfo: any,
  userTokenBase: PublicKey,
  userTokenQuote: PublicKey,
  walletPubkey: PublicKey,
  baseShare: BN,
  quoteShare: BN,
  minBaseAmount: BN,
  minQuoteAmount: BN,
) {
  let baseSourceRef = userTokenBase;
  let quoteSourceRef = userTokenQuote;

  const baseSOL = poolConfig.base === "SOL";
  const quoteSOL = poolConfig.quote === "SOL";
  const wrappedSolRefKeyPair = Keypair.generate();
  let nativeSOLHandlingTransactions = null;
  if (baseSOL || quoteSOL) {
    const rentLamports = await program.provider.connection.getMinimumBalanceForRentExemption(
      AccountLayout.span,
    );
    const wrappedSOLLamport = rentLamports;

    nativeSOLHandlingTransactions = createWrapSOLTransactions(
      wrappedSolRefKeyPair.publicKey,
      wrappedSOLLamport,
      walletPubkey,
    );

    if (baseSOL) {
      baseSourceRef = wrappedSolRefKeyPair.publicKey;
    } else {
      quoteSourceRef = wrappedSolRefKeyPair.publicKey;
    }
  }

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
    userTokenQuote: quoteSourceRef,
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
      program.transaction.withdrawFromStableSwap(
        baseShare,
        quoteShare,
        minBaseAmount,
        minQuoteAmount,
        {
          accounts: withdrawAccounts,
        },
      ),
    );
  } else {
    transaction.add(
      program.transaction.withdrawFromNormalSwap(
        baseShare,
        quoteShare,
        minBaseAmount,
        minQuoteAmount,
        {
          accounts: withdrawAccounts,
        },
      ),
    );
  }

  const signers = [];
  if (baseSOL || quoteSOL) {
    const {
      createWrappedTokenAccountTransaction,
      initializeWrappedTokenAccountTransaction,
      closeWrappedTokenAccountTransaction,
    } = nativeSOLHandlingTransactions;
    transaction = mergeTransactions([
      createWrappedTokenAccountTransaction,
      initializeWrappedTokenAccountTransaction,
      transaction,
      closeWrappedTokenAccountTransaction,
    ]);
    signers.push(wrappedSolRefKeyPair);
  }

  return { transaction, signers };
}
