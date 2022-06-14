import BigNumber from "bignumber.js";
import { TokenConfig } from "../calculations/types";
import { Connection, PublicKey } from "@solana/web3.js";
import { parsePriceData, PriceData } from "@pythnetwork/client";

export type SymbolToPythPriceData = Record<string, PriceData>;
export type MarketPriceTuple = {
  marketPrice: BigNumber;
  lowPrice: BigNumber;
  highPrice: BigNumber;
};

export async function getSymbolToPythPriceData(
  connection: Connection,
  tokenConfigs: TokenConfig[],
) {
  const pythTokenConfigs = tokenConfigs.filter(({ pyth }) => !!pyth);
  const pythPricePubkeyList = pythTokenConfigs.map(({ pyth }) => new PublicKey(pyth.price));
  const pythPriceAccountList = await connection.getMultipleAccountsInfo(pythPricePubkeyList);
  const symbolToPythPriceData = {};
  for (let i = 0; i < pythTokenConfigs.length; i++) {
    const tokenConfig = pythTokenConfigs[i];
    const symbol = tokenConfig.symbol;
    if (tokenConfig.pyth.productName.startsWith("Mock")) {
      symbolToPythPriceData[symbol] = {
        price: tokenConfig.pyth.mockPrice,
        confidenceInterval: 0,
      };
    } else {
      const priceData = parsePriceData(pythPriceAccountList[i].data as Buffer);
      symbolToPythPriceData[symbol] = priceData;
    }
  }
  return symbolToPythPriceData;
}

export function getMarketPriceTuple(
  symbolToPythPriceData: SymbolToPythPriceData,
  baseSymbol: string,
  quoteSymbol: string,
): MarketPriceTuple {
  const basePythPriceData = symbolToPythPriceData[baseSymbol];
  const quotePythPriceData = symbolToPythPriceData[quoteSymbol];

  const marketPrice = new BigNumber(basePythPriceData.price).dividedBy(
    new BigNumber(quotePythPriceData.price),
  );
  const highPrice = new BigNumber(basePythPriceData.price + basePythPriceData.confidence).dividedBy(
    new BigNumber(quotePythPriceData.price - quotePythPriceData.confidence),
  );
  const lowPrice = new BigNumber(basePythPriceData.price - basePythPriceData.confidence).dividedBy(
    new BigNumber(quotePythPriceData.price + quotePythPriceData.confidence),
  );

  return {
    marketPrice,
    lowPrice,
    highPrice,
  };
}
