export type PythConfig = {
  price: string;
  product: string;
};

export type TokenConfig = {
  pyth: PythConfig;
  symbol: string;
  mint: string;
  logoURI: string;
  name: string;
  decimals: number;
};
