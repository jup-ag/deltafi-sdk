# deltafi-sdk
## Instruction to run the example
Under the `src` folder

Install packages first:
``` 
yarn install
```

Then run the example with example keypair on testnet
```
yarn ts-node src/example/example.ts run -k ./keypairs/testnet-keypair.json -n testnet
```

You can also use your own keypair on mainnet-beta
```
yarn ts-node src/example/example.ts run -k <your_keypair> -n mainnet-beta
```

