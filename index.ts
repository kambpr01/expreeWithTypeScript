import express, { Express, Request, Response } from 'express';
import * as grpc from '@grpc/grpc-js';
import { connect, Contract, Identity, Signer, signers } from '@hyperledger/fabric-gateway';
import * as crypto from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { TextDecoder } from 'util';



/**
 * envOrDefault() will return the value of an environment variable, or a default value if the variable is undefined.
 */
function envOrDefault(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

const channelName = envOrDefault('CHANNEL_NAME', 'mychannel');
const chaincodeName = envOrDefault('CHAINCODE_NAME', 'basic');
const mspId = envOrDefault('MSP_ID', 'Org1MSP');

// Path to crypto materials.
const cryptoPath = envOrDefault('CRYPTO_PATH', path.resolve(__dirname, '..', '..', '..', 'test-network', 'organizations', 'peerOrganizations', 'org1.example.com'));

// Path to user private key directory.
const keyDirectoryPath = envOrDefault('KEY_DIRECTORY_PATH', path.resolve(cryptoPath, 'users', 'User1@org1.example.com', 'msp', 'keystore'));

// Path to user certificate.
const certPath = envOrDefault('CERT_PATH', path.resolve(cryptoPath, 'users', 'User1@org1.example.com', 'msp', 'signcerts', 'cert.pem'));

// Path to peer tls certificate.
const tlsCertPath = envOrDefault('TLS_CERT_PATH', path.resolve(cryptoPath, 'peers', 'peer0.org1.example.com', 'tls', 'ca.crt'));

// Gateway peer endpoint.
const peerEndpoint = envOrDefault('PEER_ENDPOINT', 'localhost:7051');

// Gateway peer SSL host name override.
const peerHostAlias = envOrDefault('PEER_HOST_ALIAS', 'peer0.org1.example.com');

const utf8Decoder = new TextDecoder();
const claimId = `claim${Date.now()}`;

async function newIdentity(): Promise<Identity> {
  const credentials = await fs.readFile(certPath);
  return { mspId, credentials };
}

async function newSigner(): Promise<Signer> {
  const files = await fs.readdir(keyDirectoryPath);
  const keyPath = path.resolve(keyDirectoryPath, files[0]);
  const privateKeyPem = await fs.readFile(keyPath);
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  return signers.newPrivateKeySigner(privateKey);
}


async function newGrpcConnection(): Promise<grpc.Client> {
  const tlsRootCert = await fs.readFile(tlsCertPath);
  const tlsCredentials = grpc.credentials.createSsl(tlsRootCert);
  return new grpc.Client(peerEndpoint, tlsCredentials, {
    'grpc.ssl_target_name_override': peerHostAlias,
  });
}


async function initLedger() {
  console.log('reached');
  const client = await newGrpcConnection();
  const gateway = connect({
    client,
    identity: await newIdentity(),
    signer: await newSigner(),
    // Default timeouts for different gRPC calls
    evaluateOptions: () => {
      return { deadline: Date.now() + 5000 }; // 5 seconds
    },
    endorseOptions: () => {
      return { deadline: Date.now() + 15000 }; // 15 seconds
    },
    submitOptions: () => {
      return { deadline: Date.now() + 5000 }; // 5 seconds
    },
    commitStatusOptions: () => {
      return { deadline: Date.now() + 60000 }; // 1 minute
    },
  });

  const network = gateway.getNetwork(channelName);
  const contract = network.getContract(chaincodeName);
  // The gRPC client connection should be shared by all Gateway connections to this endpoint.
  // Get the smart contract from the network.


  console.log('\n--> Submit Transaction: InitLedger, function creates the initial set of claims on the ledger');

  await contract.submitTransaction('InitLedger');

  return '*** Transaction committed successfully';
}

const app: Express = express();

app.get('/', (req: Request, res: Response) => {
  let resReceived = initLedger();
  res.send('Express + TypeScript Server' + resReceived);
});

app.listen(5000, () => {
  console.log(`⚡️[server]: Server is running at https://localhost:5000`);
});