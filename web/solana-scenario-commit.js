(function () {
  "use strict";

  const DATA_VERSION = "belfast_2016_2026_v1";
  const ENGINE_VERSION = "sim_v0.3";
  const AGENT_VERSION = "agents_v0.2";
  const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
  const MAX_MEMO_BYTES = 512;

  let configPromise = null;

  function stableStringify(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
    return "{" + Object.keys(value)
      .filter(key => value[key] !== undefined)
      .sort()
      .map(key => JSON.stringify(key) + ":" + stableStringify(value[key]))
      .join(",") + "}";
  }

  function bytes(text) {
    return new TextEncoder().encode(String(text || ""));
  }

  function hex(buffer) {
    return Array.from(new Uint8Array(buffer))
      .map(byte => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  async function hashScenarioProof(proof) {
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error("Secure browser crypto is unavailable; open the app over http://localhost or https.");
    }
    const digest = await window.crypto.subtle.digest("SHA-256", bytes(stableStringify(proof)));
    return hex(digest);
  }

  function defaultConfig() {
    return {
      cluster: "devnet",
      rpcUrl: "https://api.devnet.solana.com",
      appUrl: window.location.origin,
      memoProgramId: MEMO_PROGRAM_ID
    };
  }

  async function solanaConfig() {
    if (!configPromise) {
      configPromise = fetch("/api/solana/config")
        .then(res => res.ok ? res.json() : defaultConfig())
        .catch(() => defaultConfig())
        .then(config => Object.assign(defaultConfig(), config || {}));
    }
    return configPromise;
  }

  function explorerUrl(signature, cluster) {
    const suffix = cluster && cluster !== "mainnet-beta" ? "?cluster=" + encodeURIComponent(cluster) : "";
    return "https://explorer.solana.com/tx/" + encodeURIComponent(signature) + suffix;
  }

  function buildScenarioMemo(commit) {
    const fields = [
      "REPLAY_BELFAST",
      "v=1",
      "hash=" + commit.scenarioHash,
      "uri=" + commit.metadataUri,
      "data=" + commit.dataVersion,
      "engine=" + commit.engineVersion,
      "agents=" + commit.agentVersion
    ];
    let memo = fields.join("|");
    if (bytes(memo).length <= MAX_MEMO_BYTES) return memo;
    memo = [
      "REPLAY_BELFAST",
      "v=1",
      "hash=" + commit.scenarioHash,
      "uri=" + commit.metadataUri,
      "data=" + commit.dataVersion,
      "engine=" + commit.engineVersion,
      "agents=" + commit.agentVersion
    ].join("|");
    if (bytes(memo).length <= MAX_MEMO_BYTES) return memo;
    return [
      "REPLAY_BELFAST",
      "v=1",
      "hash=" + commit.scenarioHash,
      "uri_hash=" + commit.metadataUriHash,
      "data=" + commit.dataVersion,
      "engine=" + commit.engineVersion,
      "agents=" + commit.agentVersion
    ].join("|");
  }

  function walletProvider() {
    const provider = window.solana;
    if (provider && provider.isPhantom) return provider;
    return provider || null;
  }

  async function connectWallet() {
    const provider = walletProvider();
    if (!provider) {
      const error = new Error("Phantom or another Solana wallet was not found.");
      error.code = "WALLET_MISSING";
      throw error;
    }
    if (!provider.publicKey || !provider.isConnected) {
      await provider.connect();
    }
    if (!provider.publicKey) {
      const error = new Error("Wallet connection did not return a public key.");
      error.code = "WALLET_NOT_CONNECTED";
      throw error;
    }
    return provider;
  }

  async function sendMemoTransaction(memo, config) {
    const web3 = window.solanaWeb3;
    if (!web3) throw new Error("Solana web3 runtime failed to load.");
    const provider = await connectWallet();
    const publicKey = provider.publicKey;
    const connection = new web3.Connection(config.rpcUrl, "confirmed");
    const latest = await connection.getLatestBlockhash("confirmed");

    const transaction = new web3.Transaction();
    transaction.feePayer = publicKey;
    transaction.recentBlockhash = latest.blockhash;
    transaction.add(new web3.TransactionInstruction({
      keys: [],
      programId: new web3.PublicKey(config.memoProgramId || MEMO_PROGRAM_ID),
      data: bytes(memo)
    }));

    let signature;
    if (typeof provider.signAndSendTransaction === "function") {
      const result = await provider.signAndSendTransaction(transaction);
      signature = typeof result === "string" ? result : result && result.signature;
    } else if (typeof provider.signTransaction === "function") {
      const signed = await provider.signTransaction(transaction);
      signature = await connection.sendRawTransaction(signed.serialize());
    } else {
      const error = new Error("Connected wallet cannot sign Solana transactions.");
      error.code = "WALLET_UNSUPPORTED";
      throw error;
    }

    if (!signature) throw new Error("Wallet did not return a transaction signature.");
    const confirmation = await connection.confirmTransaction({
      signature,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight
    }, "confirmed");
    if (confirmation.value && confirmation.value.err) {
      const error = new Error("Solana transaction failed during confirmation.");
      error.code = "TX_FAILED";
      error.detail = confirmation.value.err;
      throw error;
    }
    return {
      signature,
      publicKey: publicKey.toString()
    };
  }

  function friendlySolanaError(error) {
    const message = String(error && (error.message || error.reason || error) || "");
    const code = error && error.code;
    if (code === 4001 || /reject|denied|cancel/i.test(message)) return "Signature rejected in wallet.";
    if (code === "WALLET_MISSING") return "Install or unlock Phantom to publish the scenario commit.";
    if (code === "WALLET_NOT_CONNECTED") return "Wallet connection was not completed.";
    if (/failed to fetch|network|fetch/i.test(message)) return "Solana RPC is unavailable right now. Try again in a moment.";
    if (code === "TX_FAILED") return "The Solana transaction failed during confirmation.";
    return message || "Could not publish the scenario commit.";
  }

  async function publishScenarioProof(proof) {
    const config = await solanaConfig();
    const hash = await hashScenarioProof(proof);
    const scenarioHash = "sha256:" + hash;
    const metadataUri = config.appUrl.replace(/\/+$/, "") + "/api/scenarios/" + encodeURIComponent(proof.scenarioId) + "/proof";
    const uriHash = await hashScenarioProof({ metadataUri });

    const response = await fetch(metadataUri, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ proof })
    });
    const stored = await response.json().catch(() => ({}));
    if (!response.ok || stored.ok === false) {
      throw new Error(stored.detail || stored.error || "Could not store the off-chain scenario proof.");
    }
    if (stored.hash && stored.hash !== hash) {
      throw new Error("Server proof hash did not match the browser hash.");
    }

    const memo = buildScenarioMemo({
      scenarioHash,
      metadataUri,
      metadataUriHash: "sha256:" + uriHash,
      dataVersion: proof.dataVersion || DATA_VERSION,
      engineVersion: proof.engineVersion || ENGINE_VERSION,
      agentVersion: proof.agentVersion || AGENT_VERSION
    });
    const tx = await sendMemoTransaction(memo, config);
    return {
      cluster: config.cluster || "devnet",
      signature: tx.signature,
      publicKey: tx.publicKey,
      scenarioHash,
      hash,
      metadataUri,
      memo,
      explorerUrl: explorerUrl(tx.signature, config.cluster || "devnet"),
      publishedAt: new Date().toISOString()
    };
  }

  window.ReplaySolana = {
    DATA_VERSION,
    ENGINE_VERSION,
    AGENT_VERSION,
    buildScenarioMemo,
    connectWallet,
    explorerUrl,
    friendlySolanaError,
    hashScenarioProof,
    publishScenarioProof,
    solanaConfig,
    stableStringify
  };
})();
