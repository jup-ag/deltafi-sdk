import { token } from "@project-serum/anchor/dist/cjs/utils";
import { Token, TOKEN_PROGRAM_ID, u64 } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { mergeTransactions } from "./utils";
import { toBufferLE } from "bigint-buffer";
import { web3, BN } from "@project-serum/anchor";

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
