const { SigningCosmWasmClient } = require('@cosmjs/cosmwasm-stargate');
const { DirectSecp256k1Wallet } = require('@cosmjs/proto-signing');
const { calculateFee, GasPrice } = require('@cosmjs/stargate');
const fs = require('fs').promises;
const readline = require('readline');
const chalk = require('chalk');

const logInfo = (message) => console.log(chalk.cyan(`ℹ️ ${message}`));
const logSuccess = (message) => console.log(chalk.green(`✅ ${message}`));
const logError = (message) => console.log(chalk.red(`❌ ${message}`));
const logWarning = (message) => console.log(chalk.yellow(`⚠️ ${message}`));

const RPC_URL = 'https://testnet-rpc.zigchain.com';
const GAS_PRICE = GasPrice.fromString('0.025uzig');
const DENOM = 'uzig';
const TOKEN_DECIMALS = 6;
const CHAIN_ID = 'zig-test-2';
const RECIPIENT_ADDRESS = 'zig13rpmgsk09jcd7yfemwmj5gvkahr9tu0h7tawjk';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 30000;

async function getBalance(client, address) {
    try {
        const balance = await client.getBalance(address, DENOM);
        return parseInt(balance.amount) / Math.pow(10, TOKEN_DECIMALS);
    } catch (error) {
        logError(`Failed to fetch balance for ${address}: ${error.message}`);
        throw error;
    }
}

async function transferZig(client, wallet, recipientAddress, amountUzig, senderAddress) {
    try {
        const fee = calculateFee(86531, GAS_PRICE);
        const sendMsg = {
            typeUrl: '/cosmos.bank.v1beta1.MsgSend',
            value: {
                fromAddress: senderAddress,
                toAddress: recipientAddress,
                amount: [{ denom: DENOM, amount: Math.floor(amountUzig).toString() }],
            },
        };
        const result = await client.signAndBroadcast(senderAddress, [sendMsg], fee, 'Auto Transfer ZIG');
        logSuccess(`Transferred ${amountUzig / Math.pow(10, TOKEN_DECIMALS)} ZIG from ${senderAddress} to ${recipientAddress} successfully (TxHash: ${result.transactionHash})`);
        return true;
    } catch (error) {
        logError(`Transfer from ${senderAddress} failed: ${error.message}`);
        logError(`Error details: ${JSON.stringify(error, null, 2)}`);
        return false;
    }
}

async function getUserInput(prompt) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise((resolve) => {
        rl.question(prompt, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function connectWithRetry(wallet) {
    let retries = 0;
    while (retries < MAX_RETRIES) {
        try {
            const client = await SigningCosmWasmClient.connectWithSigner(RPC_URL, wallet, { gasPrice: GAS_PRICE, prefix: 'zig' });
            return client;
        } catch (error) {
            retries++;
            if (error.message.includes('429') && retries < MAX_RETRIES) {
                logWarning(`Rate limit (429) detected, retrying ${retries}/${MAX_RETRIES} after ${RETRY_DELAY_MS/1000} seconds...`);
                await delay(RETRY_DELAY_MS);
            } else {
                throw error;
            }
        }
    }
    throw new Error(`Failed to connect after ${MAX_RETRIES} retries`);
}

async function main() {
    process.stdout.write('\x1b]2;TF Zig by : 佐賀県産 （𝒀𝑼𝑼𝑹𝑰）\x1b\\');
    console.log(chalk.magenta(`
╔══════════════════════════════════════════════╗
║       🌟 ZIG BOT - Automated Transfer        ║
║   Automate ZIG token transfers on ZigChain!  ║
║  Developed by: https://t.me/sentineldiscus   ║
╚══════════════════════════════════════════════╝
    `));

    const recipientAddress = RECIPIENT_ADDRESS;
    logInfo(`Recipient address: "${recipientAddress}" (length: ${recipientAddress.length})`);
    logInfo(`Hex address: ${Buffer.from(recipientAddress).toString('hex')}`);

    if (!recipientAddress) {
        logError('Recipient address not found');
        return;
    }
    if (!recipientAddress.startsWith('zig1')) {
        logError(`Invalid recipient address: must start with "zig1" (found: "${recipientAddress}")`);
        return;
    }

    let wallets;
    try {
        const data = await fs.readFile('wallets.json', 'utf8');
        wallets = JSON.parse(data);
    } catch (error) {
        logError(`Failed to read wallets.json: ${error.message}`);
        return;
    }

    logInfo('Select transfer option:');
    logInfo('1. Fixed amount (all wallets send the same ZIG amount)');
    logInfo('2. Random (each wallet sends 1-49 ZIG randomly)');
    logInfo('3. Send all balance from all wallets');
    const choice = await getUserInput('Enter choice (1/2/3): ');

    let amountZig;
    if (choice === '1') {
        const amountInput = await getUserInput('Enter ZIG amount: ');
        try {
            amountZig = parseFloat(amountInput);
            if (isNaN(amountZig) || amountZig <= 0) {
                logError('Amount must be greater than 0');
                return;
            }
        } catch (error) {
            logError('Invalid amount, must be a number');
            return;
        }
    }

    let client;
    try {
        client = await connectWithRetry(null);
        logInfo(`Connected to RPC: ${RPC_URL}`);
    } catch (error) {
        logError(`Failed to connect to RPC: ${error.message}`);
        logError(`Error details: ${JSON.stringify(error, null, 2)}`);
        return;
    }

    for (const walletData of wallets) {
        const { address, privateKey } = walletData;
        logInfo(`Processing wallet: ${address}`);

        let wallet;
        try {
            wallet = await DirectSecp256k1Wallet.fromKey(Buffer.from(privateKey, 'hex'), 'zig');
        } catch (error) {
            logError(`Failed to create wallet ${address}: ${error.message}`);
            continue;
        }

        let retries = 0;
        while (retries < MAX_RETRIES) {
            try {
                client = await connectWithRetry(wallet);
                break;
            } catch (error) {
                retries++;
                if (error.message.includes('429') && retries < MAX_RETRIES) {
                    logWarning(`Rate limit (429) for wallet ${address}, retrying ${retries}/${MAX_RETRIES} after ${RETRY_DELAY_MS/1000} seconds...`);
                    await delay(RETRY_DELAY_MS);
                } else {
                    logError(`Failed to connect wallet ${address}: ${error.message}`);
                    break;
                }
            }
        }
        if (retries >= MAX_RETRIES) {
            logError(`Skipping wallet ${address} after ${MAX_RETRIES} retries`);
            continue;
        }

        let balance;
        retries = 0;
        while (retries < MAX_RETRIES) {
            try {
                balance = await getBalance(client, address);
                break;
            } catch (error) {
                retries++;
                if (error.message.includes('429') && retries < MAX_RETRIES) {
                    logWarning(`Rate limit (429) when fetching balance for ${address}, retrying ${retries}/${MAX_RETRIES} after ${RETRY_DELAY_MS/1000} seconds...`);
                    await delay(RETRY_DELAY_MS);
                    try {
                        client = await connectWithRetry(wallet);
                    } catch (retryError) {
                        logError(`Failed to reconnect wallet ${address}: ${retryError.message}`);
                        break;
                    }
                } else {
                    logError(`Failed to fetch balance for ${address}: ${error.message}`);
                    balance = 0;
                    break;
                }
            }
        }
        if (balance <= 0) {
            logWarning(`Insufficient balance for ${address}: ${balance.toFixed(6)} ZIG`);
            continue;
        }

        let amountUzig;
        if (choice === '1') {
            amountUzig = amountZig * Math.pow(10, TOKEN_DECIMALS);
            if (amountUzig > balance * Math.pow(10, TOKEN_DECIMALS)) {
                logWarning(`Insufficient balance for ${address}: ${balance.toFixed(6)} ZIG, requested ${amountZig.toFixed(6)} ZIG`);
                continue;
            }
        } else if (choice === '2') {
            const randomZig = Math.floor(Math.random() * 49) + 1;
            amountUzig = randomZig * Math.pow(10, TOKEN_DECIMALS);
            if (amountUzig > balance * Math.pow(10, TOKEN_DECIMALS)) {
                logWarning(`Insufficient balance for ${address}: ${balance.toFixed(6)} ZIG, requested ${randomZig.toFixed(6)} ZIG`);
                continue;
            }
            logInfo(`Random amount: ${randomZig} ZIG`);
        } else if (choice === '3') {
            amountUzig = (balance - 0.01) * Math.pow(10, TOKEN_DECIMALS);
            if (amountUzig <= 0) {
                logWarning(`Insufficient balance after gas for ${address}`);
                continue;
            }
            logInfo(`Sending all balance: ${(amountUzig / Math.pow(10, TOKEN_DECIMALS)).toFixed(6)} ZIG`);
        } else {
            logError('Invalid choice, use 1, 2, or 3');
            return;
        }

        await transferZig(client, wallet, recipientAddress, amountUzig, address);
        await delay(1000);
    }
}

main().catch(error => {
    logError(`Error: ${error.message}`);
    logError(`Error details: ${JSON.stringify(error, null, 2)}`);
});
