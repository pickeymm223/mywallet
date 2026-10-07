// MyWallet - Non-custodial multi-chain crypto wallet
import * as bip39 from 'bip39';
import { ethers } from 'ethers';
import * as bitcoin from 'bitcoinjs-lib';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';
import { TronWeb } from 'tronweb';
import QRCode from 'qrcode';

const bip32 = BIP32Factory(ecc);

// Chain configurations
const CHAINS = {
  eth: { name: 'Ethereum', symbol: 'ETH', icon: '⟠', color: '#627eea', path: "m/44'/60'/0'/0/0", rpc: 'https://eth.llamarpc.com', usdt: '0xdAC17F958D2e523B6909fA1B1b2F38d1F6bA1D5c' },
  bsc: { name: 'BNB Chain', symbol: 'BNB', icon: '⬡', color: '#f0b90b', path: "m/44'/60'/0'/0/0", rpc: 'https://bsc-dataseed.binance.org', usdt: '0x55d398326f99059f775485246999027B3197955' },
  tron: { name: 'Tron', symbol: 'TRX', icon: '◈', color: '#ff0013', path: "m/44'/195'/0'/0/0", rpc: 'https://api.trongrid.io', usdt: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' },
  btc: { name: 'Bitcoin', symbol: 'BTC', icon: '₿', color: '#f7931a', path: "m/84'/0'/0'/0/0" },
  ton: { name: 'TON', symbol: 'TON', icon: '💎', color: '#0098ea', path: "m/44'/607'/0'" }
};

let currentMnemonic = null;
let walletData = null;

// Generate new mnemonic
async function initCreate() {
  currentMnemonic = bip39.generateMnemonic();
  const words = currentMnemonic.split(' ');
  document.getElementById('seedWords').innerHTML = words.map((w, i) => 
    `<div class="seed-word"><span>${i+1}</span>${w}</div>`
  ).join('');
}

// Copy seed
window.copySeed = function() {
  navigator.clipboard.writeText(currentMnemonic);
  alert('ကူးယူပြီးပြီ!');
};

// Confirm seed - show random words to verify
let confirmIndices = [];
window.confirmSeed = function() {
  const words = currentMnemonic.split(' ');
  confirmIndices = [2, 5, 8].map(() => Math.floor(Math.random() * 12));
  document.getElementById('confirmWords').innerHTML = confirmIndices.map(idx => `
    <div style="margin-bottom:12px">
      <label style="color:#8892b0">စကားလုံး #${idx+1}</label>
      <input id="confirm-${idx}" placeholder="ရိုက်ထည့်ပါ">
    </div>
  `).join('');
  showScreen('screen-confirm');
};

window.verifySeed = function() {
  const words = currentMnemonic.split(' ');
  for (let idx of confirmIndices) {
    const input = document.getElementById(`confirm-${idx}`).value.trim().toLowerCase();
    if (input !== words[idx]) {
      alert('မှားနေတယ်! ပြန်စစ်ပါ');
      return;
    }
  }
  showScreen('screen-password');
};

// Import wallet
window.importWallet = function() {
  const seed = document.getElementById('importSeed').value.trim();
  if (!bip39.validateMnemonic(seed)) {
    alert('Seed phrase မှားနေတယ်!');
    return;
  }
  currentMnemonic = seed;
  showScreen('screen-password');
};

// Setup password and encrypt
window.setupPassword = async function() {
  const p1 = document.getElementById('pwd1').value;
  const p2 = document.getElementById('pwd2').value;
  if (p1.length < 6) { alert('Password အနည်းဆုံး 6 လုံး'); return; }
  if (p1 !== p2) { alert('Password မတူဘူး!'); return; }
  
  // Encrypt mnemonic with password
  const encrypted = await encryptData(currentMnemonic, p1);
  localStorage.setItem('wallet_enc', encrypted);
  await initWallet(currentMnemonic);
  showScreen('screen-main');
};

async function encryptData(text, password) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password.padEnd(32).slice(0,32)), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, enc.encode(text));
  return JSON.stringify({iv: Array.from(iv), data: Array.from(new Uint8Array(encrypted))});
}

// Derive addresses for all chains
async function deriveAddresses(mnemonic) {
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const addresses = {};
  
  for (let [key, chain] of Object.entries(CHAINS)) {
    try {
      if (key === 'eth' || key === 'bsc') {
        const hdNode = ethers.HDNodeWallet.fromSeed(seed);
        const child = hdNode.derivePath(chain.path);
        addresses[key] = child.address;
      } else if (key === 'tron') {
        const node = bip32.fromSeed(seed);
        const child = node.derivePath(chain.path);
        const privateKey = Buffer.from(child.privateKey).toString('hex');
        const tronWeb = new TronWeb({ fullHost: chain.rpc });
        addresses[key] = tronWeb.address.fromPrivateKey(privateKey);
        addresses[key + '_pk'] = privateKey;
      } else if (key === 'btc') {
        const node = bip32.fromSeed(seed);
        const child = node.derivePath(chain.path);
        const { address } = bitcoin.payments.p2wpkh({ 
          pubkey: child.publicKey, 
          network: bitcoin.networks.bitcoin 
        });
        addresses[key] = address;
      } else if (key === 'ton') {
        // TON uses ed25519 - simplified, would need @ton/crypto
        addresses[key] = 'TON address (coming soon)';
      }
    } catch (e) {
      console.error(`Failed to derive ${key}:`, e);
      addresses[key] = 'Error';
    }
  }
  
  // Store private keys securely (in memory only)
  const ethNode = ethers.HDNodeWallet.fromSeed(seed);
  addresses['eth_pk'] = ethNode.derivePath(CHAINS.eth.path).privateKey;
  addresses['bsc_pk'] = addresses['eth_pk']; // Same path for BSC
  
  const btcNode = bip32.fromSeed(seed);
  addresses['btc_pk'] = Buffer.from(btcNode.derivePath(CHAINS.btc.path).privateKey).toString('hex');
  
  return addresses;
}

// Initialize wallet
async function initWallet(mnemonic) {
  walletData = await deriveAddresses(mnemonic);
  renderChains();
  loadBalances();
}

function renderChains() {
  const list = document.getElementById('chainList');
  list.innerHTML = Object.entries(CHAINS).map(([key, chain]) => `
    <div class="chain-item" onclick="selectChain('${key}')">
      <div class="chain-info">
        <div class="chain-icon" style="background:${chain.color}20;color:${chain.color}">${chain.icon}</div>
        <div>
          <div class="chain-name">${chain.name}</div>
          <div class="chain-balance" style="font-family:monospace;font-size:11px">${(walletData[key]||'').slice(0,20)}...</div>
        </div>
      </div>
      <div class="chain-amount" id="bal-${key}">...</div>
    </div>
  `).join('');
}

async function loadBalances() {
  for (let [key, chain] of Object.entries(CHAINS)) {
    try {
      let balance = '0';
      const address = walletData[key];
      if (!address || address === 'Error') continue;
      
      if (key === 'eth' || key === 'bsc') {
        const provider = new ethers.JsonRpcProvider(chain.rpc);
        const bal = await provider.getBalance(address);
        balance = parseFloat(ethers.formatEther(bal)).toFixed(4);
      } else if (key === 'tron') {
        const tronWeb = new TronWeb({ fullHost: chain.rpc });
        const bal = await tronWeb.trx.getBalance(address);
        balance = (bal / 1e6).toFixed(2);
      } else if (key === 'btc') {
        const resp = await fetch(`https://blockstream.info/api/address/${address}`);
        const data = await resp.json();
        balance = ((data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum) / 1e8).toFixed(8);
      }
      
      document.getElementById(`bal-${key}`).textContent = `${balance} ${chain.symbol}`;
    } catch (e) {
      console.error(`Balance fetch failed for ${key}:`, e);
      document.getElementById(`bal-${key}`).textContent = 'Error';
    }
  }
}

window.selectChain = function(key) {
  // Show chain details
  alert(`${CHAINS[key].name}\n${walletData[key]}`);
};

// Send screen
window.initSendScreen = function() {
  document.getElementById('sendChain').innerHTML = Object.entries(CHAINS)
    .map(([k, c]) => `<option value="${k}">${c.name} (${c.symbol})</option>`).join('');
}

window.sendCrypto = async function() {
  const chainKey = document.getElementById('sendChain').value;
  const to = document.getElementById('sendTo').value.trim();
  const amount = document.getElementById('sendAmount').value;
  
  if (!to || !amount) { alert('လိပ်စာနဲ့ ပမာဏ ဖြည့်ပါ'); return; }
  if (!confirm(`${amount} ${CHAINS[chainKey].symbol} ကို ${to} သို့ ပို့မလား?`)) return;
  
  try {
    if (chainKey === 'eth' || chainKey === 'bsc') {
      const provider = new ethers.JsonRpcProvider(CHAINS[chainKey].rpc);
      const wallet = new ethers.Wallet(walletData[chainKey + '_pk'], provider);
      const tx = await wallet.sendTransaction({ to, value: ethers.parseEther(amount) });
      alert(`ပို့ပြီးပြီ!\nTX: ${tx.hash}`);
    } else {
      alert('ဒီ chain အတွက် send function မပြီးသေးပါ');
    }
  } catch (e) {
    alert('Error: ' + e.message);
  }
};

// Receive screen
window.initReceiveScreen = function() {
  document.getElementById('receiveChain').innerHTML = Object.entries(CHAINS)
    .map(([k, c]) => `<option value="${k}">${c.name}</option>`).join('');
  updateReceiveAddress();
}

window.updateReceiveAddress = function() {
  const key = document.getElementById('receiveChain').value;
  const addr = walletData[key];
  document.getElementById('receiveAddress').textContent = addr;
  QRCode.toCanvas(document.getElementById('qrCode'), addr, { width: 200 });
};

window.copyAddress = function() {
  navigator.clipboard.writeText(document.getElementById('receiveAddress').textContent);
  alert('ကူးယူပြီးပြီ!');
};

// Settings
window.exportSeed = async function() {
  const pwd = prompt('Password ရိုက်ထည့်ပါ:');
  if (!pwd) return;
  try {
    const enc = JSON.parse(localStorage.getItem('wallet_enc'));
    const decrypted = await decryptData(enc, pwd);
    alert('Seed Phrase:\n' + decrypted);
  } catch (e) {
    alert('Password မှားနေတယ်!');
  }
};

async function decryptData(encData, password) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password.padEnd(32).slice(0,32)), 'AES-GCM', false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt(
    {name:'AES-GCM', iv: new Uint8Array(encData.iv)}, 
    key, 
    new Uint8Array(encData.data)
  );
  return new TextDecoder().decode(decrypted);
}

window.logout = function() {
  if (confirm('Logout လုပ်မလား? (Seed phrase မှတ်ထားပြီးမှ လုပ်ပါ!)')) {
    localStorage.removeItem('wallet_enc');
    location.reload();
  }
};

// Init - check if wallet exists
if (localStorage.getItem('wallet_enc')) {
  // Wallet exists, show unlock screen
  showScreen('screen-welcome');
  document.querySelector('#screen-welcome .btn-primary').textContent = '🔓 Wallet ဖွင့်မယ်';
  document.querySelector('#screen-welcome .btn-primary').onclick = function() {
    const pwd = prompt('Password ရိုက်ထည့်ပါ:');
    if (pwd) unlockWallet(pwd);
  };
  document.querySelector('#screen-welcome .btn-secondary').style.display = 'none';
} else {
  initCreate();
}

async function unlockWallet(password) {
  try {
    const enc = JSON.parse(localStorage.getItem('wallet_enc'));
    const mnemonic = await decryptData(enc, password);
    await initWallet(mnemonic);
    showScreen('screen-main');
  } catch (e) {
    alert('Password မှားနေတယ်!');
  }
}
