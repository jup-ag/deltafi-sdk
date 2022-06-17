import { DeltafiDexV2 } from "./types/deltafi_dex_v2";
import deltafiDexV2Idl from "./idl/deltafi_dex_v2.json";
import { Keypair, PublicKey } from "@solana/web3.js";
import { Program, AnchorProvider, web3 } from "@project-serum/anchor";
import * as token from "@solana/spl-token";
import { SwapConfig, SwapType } from "./type_definitions";

const serumProgramId = new web3.PublicKey("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin");

export function getClusterApiUrl(network: string) {
  if (network === "localhost") {
    return "http://localhost:8899";
  }
  return web3.clusterApiUrl(network as web3.Cluster);
}

export function makeProvider(connection, wallet) {
  return new AnchorProvider(connection, wallet, AnchorProvider.defaultOptions());
}

export function getDeltafiDexV2(
  programId: PublicKey,
  provider: AnchorProvider = null,
): Program<DeltafiDexV2> {
  const idl = JSON.parse(JSON.stringify(deltafiDexV2Idl));
  return new Program(idl, programId, provider != null ? provider : AnchorProvider.local());
}

export async function createMarketConfig(program, pythProgramId, deltafiMint, adminKeypair) {
  const seedKeyPair = web3.Keypair.generate();
  const deltafiTokenKeyPair = web3.Keypair.generate();
  const [marketConfig, bump] = await web3.PublicKey.findProgramAddress(
    [seedKeyPair.publicKey.toBuffer()],
    program.programId,
  );

  await program.rpc.createMarketConfig(bump, {
    accounts: {
      seed: seedKeyPair.publicKey,
      marketConfig: marketConfig,
      deltafiMint: deltafiMint,
      deltafiToken: deltafiTokenKeyPair.publicKey,
      pythProgram: pythProgramId,
      serumProgram: serumProgramId,
      admin: adminKeypair.publicKey,
      payer: program.provider.wallet.publicKey,
      systemProgram: web3.SystemProgram.programId,
      rent: web3.SYSVAR_RENT_PUBKEY,
      tokenProgram: token.TOKEN_PROGRAM_ID,
    },
    signers: [seedKeyPair, adminKeypair, deltafiTokenKeyPair],
  });

  return marketConfig;
}

export async function createSwap(
  program,
  marketConfig: PublicKey,
  mintBase: PublicKey,
  mintQuote: PublicKey,
  adminFeeTokenBase: PublicKey,
  adminFeeTokenQuote: PublicKey,
  swapType: SwapType,
  swapConfig: SwapConfig,
  adminKeypair: Keypair,
) {
  const seedKeypair = web3.Keypair.generate();
  const [swapInfo, swapBump] = await web3.PublicKey.findProgramAddress(
    [Buffer.from("SwapInfo", "utf-8"), marketConfig.toBuffer(), seedKeypair.publicKey.toBuffer()],
    program.programId,
  );

  const tokenBaseKeypair = web3.Keypair.generate();
  const tokenQuoteKeypair = web3.Keypair.generate();

  await program.rpc.createSwap(swapBump, swapType, swapConfig, {
    accounts: {
      marketConfig: marketConfig,
      seed: seedKeypair.publicKey,
      swapInfo,
      mintBase,
      mintQuote,
      tokenBase: tokenBaseKeypair.publicKey,
      tokenQuote: tokenQuoteKeypair.publicKey,
      adminFeeTokenBase,
      adminFeeTokenQuote,
      admin: adminKeypair.publicKey,
      payer: program.provider.wallet.publicKey,
      systemProgram: web3.SystemProgram.programId,
      rent: web3.SYSVAR_RENT_PUBKEY,
      tokenProgram: token.TOKEN_PROGRAM_ID,
    },
    signers: [adminKeypair, seedKeypair, tokenBaseKeypair, tokenQuoteKeypair],
  });

  return swapInfo;
}

export async function initSwap(
  program,
  marketConfig,
  swapInfo,
  userTokenBase,
  userTokenQuote,
  liquidityProvider,
  amountA,
  amountB,
  swapType,
  pythPriceBase,
  pythPriceQuote,
  serumMarket,
  serumBids,
  serumAsks,
  adminKeypair,
) {
  const swapInfoData = await program.account.swapInfo.fetch(swapInfo);
  const tokenBase = swapInfoData.tokenBase;
  const tokenQuote = swapInfoData.tokenQuote;

  const initSwapAccounts = {
    marketConfig: marketConfig,
    swapInfo: swapInfo,
    userTokenBase,
    userTokenQuote,
    liquidityProvider,
    tokenBase,
    tokenQuote,
    userAuthority: program.provider.wallet.publicKey,
    admin: adminKeypair.publicKey,
    tokenProgram: token.TOKEN_PROGRAM_ID,
  };

  if (swapType.normalSwap != null) {
    await program.rpc.initNormalSwap(amountA, amountB, {
      accounts: {
        pythPriceBase,
        pythPriceQuote,
        ...initSwapAccounts,
      },
      signers: [adminKeypair],
    });
  } else if (swapType.stableSwap != null) {
    await program.rpc.initStableSwap(amountA, amountB, {
      accounts: {
        pythPriceBase,
        pythPriceQuote,
        ...initSwapAccounts,
      },
      signers: [adminKeypair],
    });
  } else {
    await program.rpc.initSerumSwap(amountA, amountB, {
      accounts: {
        serumMarket,
        serumBids,
        serumAsks,
        ...initSwapAccounts,
      },
      signers: [adminKeypair],
    });
  }
}

export async function createFarm(program, marketConfig, swapInfo, seed, farmConfig, adminKeypair) {
  const [farmInfo, farmBump] = await web3.PublicKey.findProgramAddress(
    [Buffer.from("FarmInfo", "utf-8"), swapInfo.toBuffer(), seed.toBuffer()],
    program.programId,
  );
  await program.rpc.createFarm(farmBump, seed, farmConfig, {
    accounts: {
      marketConfig,
      farmInfo: farmInfo,
      swapInfo,
      admin: adminKeypair.publicKey,
      payer: program.provider.wallet.publicKey,
      systemProgram: web3.SystemProgram.programId,
      rent: web3.SYSVAR_RENT_PUBKEY,
    },
    signers: [adminKeypair],
  });
  return farmInfo;
}

export async function updateSwapConfig(program, marketConfig, swapInfo, swapConfig, adminKeypair) {
  await program.rpc.updateSwapConfig(swapConfig, {
    accounts: {
      marketConfig,
      swapInfo,
      admin: adminKeypair.publicKey,
    },
    signers: [adminKeypair],
  });
}

export async function updateSwapVirtualReserve(
  program,
  marketConfig,
  swapInfo,
  virtualBaseReserve,
  virtualQuoteReserve,
  adminKeypair,
) {
  await program.rpc.updateSwapVirtualReserve(virtualBaseReserve, virtualQuoteReserve, {
    accounts: {
      marketConfig,
      swapInfo,
      admin: adminKeypair.publicKey,
    },
    signers: [adminKeypair],
  });
}

export async function updateFarmConfig(program, marketConfig, farmInfo, farmConfig, adminKeypair) {
  await program.rpc.updateFarmConfig(farmConfig, {
    accounts: {
      marketConfig,
      farmInfo: farmInfo,
      admin: adminKeypair.publicKey,
    },
    signers: [adminKeypair],
  });
}

export async function getOrCreateLiquidityProvider(program, marketConfig, swapInfo, ownerKeypair) {
  const [lpPublicKey, lpBump] = await PublicKey.findProgramAddress(
    [Buffer.from("LiquidityProvider"), swapInfo.toBuffer(), ownerKeypair.publicKey.toBuffer()],
    program.programId,
  );

  const lp = await program.account.liquidityProvider.fetchNullable(lpPublicKey);
  if (lp) {
    return lpPublicKey;
  }

  await program.rpc.createLiquidityProviderV2(lpBump, {
    accounts: {
      marketConfig,
      swapInfo,
      liquidityProvider: lpPublicKey,
      owner: ownerKeypair.publicKey,
      payer: ownerKeypair.publicKey,
      systemProgram: web3.SystemProgram.programId,
      rent: web3.SYSVAR_RENT_PUBKEY,
    },
    signers: [ownerKeypair],
  });
  return lpPublicKey;
}

export async function getOrCreateFarmUser(program, marketConfig, farmInfo, ownerKeypair) {
  const [farmUserPubKey, farmUserBump] = await PublicKey.findProgramAddress(
    [Buffer.from("FarmUser"), farmInfo.toBuffer(), ownerKeypair.publicKey.toBuffer()],
    program.programId,
  );

  const farmUser = await program.account.farmUser.fetchNullable(farmUserPubKey);
  if (farmUser) {
    return farmUserPubKey;
  }

  await program.rpc.createFarmUserV2(farmUserBump, {
    accounts: {
      marketConfig,
      farmInfo,
      farmUser: farmUserPubKey,
      owner: ownerKeypair.publicKey,
      payer: ownerKeypair.publicKey,
      systemProgram: web3.SystemProgram.programId,
      rent: web3.SYSVAR_RENT_PUBKEY,
    },
    signers: [ownerKeypair],
  });
  return farmUserPubKey;
}

export async function createDeltafiUser(program, marketConfig, userKeypair, referrer = null) {
  const [deltafiUserPubkey, deltafiUserBump] = await PublicKey.findProgramAddress(
    [Buffer.from("User"), marketConfig.toBuffer(), userKeypair.publicKey.toBuffer()],
    program.programId,
  );

  if (referrer == null) {
    await program.rpc.createDeltafiUser(deltafiUserBump, {
      accounts: {
        marketConfig,
        owner: userKeypair.publicKey,
        deltafiUser: deltafiUserPubkey,
        systemProgram: web3.SystemProgram.programId,
        rent: web3.SYSVAR_RENT_PUBKEY,
      },
      signers: [userKeypair],
    });
  } else {
    await program.rpc.createDeltafiUserWithReferrer(deltafiUserBump, {
      accounts: {
        marketConfig,
        owner: userKeypair.publicKey,
        deltafiUser: deltafiUserPubkey,
        referrer,
        systemProgram: web3.SystemProgram.programId,
        rent: web3.SYSVAR_RENT_PUBKEY,
      },
      signers: [userKeypair],
    });
  }
  return deltafiUserPubkey;
}
