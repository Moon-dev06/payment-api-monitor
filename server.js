require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

app.use(express.static(path.join(__dirname, 'public')));
app.use(cors());
app.use(express.json());

// 🧠 เก็บ logs (optional ใช้ debug ใน console)
let logs = [];
const WebSocket = require('ws');

const wss = new WebSocket.Server({ noServer: true });

// เก็บ client
let clients = [];

wss.on('connection', (ws) => {
    console.log('✅ New WebSocket Client Connected');
    clients.push(ws);

    ws.on('close', () => {
        console.log('❌ WebSocket Client Disconnected');
        clients = clients.filter(c => c !== ws);
    });
});

// ส่ง log ไป frontend
function broadcastLog(log) {
    const data = JSON.stringify(log);
    console.log(`📡 Broadcasting ${log.type} for: ${log.url || 'N/A'}`);
    clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(data);
        }
    });
}

// Logging Middleware
app.use((req, res, next) => {
    // ข้าม favicon และไฟล์ static
    if (req.originalUrl === '/favicon.ico' || req.originalUrl.startsWith('/js/')) {
        return next();
    }

    const startTime = Date.now();
    const logId = Date.now() + Math.random().toString(36).substr(2, 9);

    // ดักจับ response body
    const oldSend = res.send;
    let responseBody;
    res.send = function (data) {
        responseBody = data;
        return oldSend.apply(res, arguments);
    };

    // ส่งตอนเริ่ม (Request)
    const requestLog = {
        id: logId,
        time: new Date().toISOString(),
        method: req.method,
        url: req.originalUrl,
        headers: req.headers,
        body: req.body || null,
        type: 'request',
        status: "processing"
    };

    broadcastLog(requestLog);

    // ส่งตอนจบ (Response)
    res.on('finish', () => {
        let parsedResBody = responseBody;
        try {
            if (typeof responseBody === 'string') {
                parsedResBody = JSON.parse(responseBody);
            }
        } catch (e) {
            // ไม่ใช่ JSON ให้เก็บไว้ตามเดิม
        }

        const responseLog = {
            id: logId,
            status: "done",
            statusCode: res.statusCode,
            duration: Date.now() - startTime,
            response: parsedResBody,
            type: 'response',
            url: req.originalUrl // ใส่ไว้เพื่อให้ debug ง่ายใน console
        };

        broadcastLog(responseLog);
    });

    next();
});


// 🔐 GET TOKEN
app.get('/v2/payment/gettoken', (req, res) => {
    const apiKey = req.headers['x-api-key'];
    const channel = req.headers['channel'];

    if (apiKey !== process.env.X_API_KEY || channel !== process.env.CHANNEL) {
        return res.status(401).json({
            jsonrpc: "2.0",
            result: {
                apiresult: {
                    issuccess: false,
                    returncode: "401",
                    message: "Invalid key or channel"
                }
            },
            id: 0
        });
    }

    const token = "mock_token_" + Date.now();
    global.accessToken = token;

    res.json({
        result: {
            payload: {
                access_token: token,
                token_type: "Bearer",
                expires_in: 3600
            }
        }
    });
});

// 🔍 INQUIRY
app.post('/payment/inquiryqrpayment', verifyToken, (req, res) => {
    try {
        const payload = req.body?.result?.payload;

        if (!payload || !payload.payments?.length) {
            return res.status(400).json({
                jsonrpc: "2.0",
                result: {
                    apiresult: {
                        issuccess: false,
                        returncode: "400",
                        message: "Invalid request payload"
                    }
                },
                id: req.body?.id || 0
            });
        }

        const amount = payload.payments[0].amount;

        res.json({
            jsonrpc: "2.0",
            result: {
                channelinfo: {
                    channel: req.headers['channel']
                },
                payload: {
                    store_id: "00120",
                    payment_type: "promptpaycb",
                    method: "inquiry",
                    payments: [
                        {
                            tender_type: "promptpaycb",
                            amount: amount
                        }
                    ]
                }
            },
            id: req.body.id
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
});

// 💳 PAYMENT
app.post('/payment/payment', verifyToken, (req, res) => {
    try {
        const payload = req.body?.result?.payload;

        if (!payload) {
            return res.status(400).json({
                jsonrpc: "2.0",
                result: {
                    apiresult: {
                        issuccess: false,
                        returncode: "400",
                        message: "Invalid payload"
                    }
                },
                id: req.body?.id || 0
            });
        }

        res.json({
            jsonrpc: "2.0",
            result: {
                apiresult: {
                    issuccess: true,
                    returncode: "0",
                    message: ""
                },
                payload: {
                    receipt_no: "R" + Date.now(),
                    stamps_earned: payload.issue?.stamp_type === "mstamp" ? 1 : 0
                }
            },
            id: req.body.id
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
});

// 🔎 CHECK PAYMENT
app.get('/payment/checkpaymenttransaction', verifyToken, (req, res) => {
    try {
        const { store_id, trans_id } = req.query;

        if (!trans_id) {
            return res.status(400).json({
                jsonrpc: "2.0",
                result: {
                    apiresult: {
                        issuccess: false,
                        returncode: "400",
                        message: "Missing trans_id"
                    }
                },
                id: 0
            });
        }

        res.json({
            jsonrpc: "2.0",
            result: {
                channelinfo: {
                    channel: req.headers['channel']
                },
                payload: {
                    store_id: store_id || "00120",
                    payment_type: "promptpaycb",
                    method: "inquiry",
                    payments: [
                        {
                            tender_type: "promptpaycb",
                            amount: 90
                        }
                    ]
                }
            },
            id: 0
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
});

// 🔐 VERIFY TOKEN
function verifyToken(req, res, next) {
    const authHeader = req.headers['authorization'];

    if (!authHeader) {
        return res.status(401).json({ message: "No token" });
    }

    const token = authHeader.split(' ')[1];

    if (token !== global.accessToken) {
        return res.status(401).json({ message: "Invalid token" });
    }
    next();
}

app.post('/logs', (req, res) => {
    const log = req.body;
    console.log("Log from Flutter:", log);
    
    // Broadcast ไปยังหน้าเว็บผ่าน WebSocket ทันที
    broadcastLog({
        ...log,
        id: log.id || "flutter-" + Date.now(),
        time: new Date().toISOString(),
        source: 'flutter' 
    });

    res.json({ success: true });
});

// 📥 รับ request log จาก client (Flutter)
app.post('/logs/request', (req, res) => {
    const log = {
        ...req.body, // ใช้ข้อมูลเดิมจาก Flutter
        type: 'request',
        time: new Date().toISOString(),
        source: 'flutter'
    };

    console.log('📥 Request Log:', log);
    logs.push(log);
    broadcastLog(log); 

    res.json({ success: true });
});

// 📤 รับ response log จาก client (Flutter)
app.post('/logs/response', (req, res) => {
    const log = {
        ...req.body, // ใช้ข้อมูลเดิมจาก Flutter
        type: 'response',
        time: new Date().toISOString(),
        source: 'flutter'
    };

    console.log('📤 Response Log:', log);
    logs.push(log);
    broadcastLog(log);

    res.json({ success: true });
});

// 🚀 START SERVER
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});

server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});


//กัน App ตายจาก Error นอก Express (เช่น Promise ที่ไม่ได้ catch)
// 🛠 Global Express Error Handler (ควรอยู่ท้ายสุดของ routes)
app.use((err, req, res, next) => {
    console.error('❌ Express Error:', err.stack);
    
    // พยายามส่ง log ไปหน้าจอ Monitor ด้วยถ้าทำได้
    broadcastLog({
        id: 'error-' + Date.now(),
        type: 'error',
        statusCode: 500,
        message: err.message,
        url: req.originalUrl,
        time: new Date().toISOString()
    });

    res.status(500).json({
        jsonrpc: "2.0",
        error: {
            code: -32603,
            message: "Internal server error",
            data: err.message
        },
        id: req.body?.id || 0
    });
});

// 🛑 Global Node.js Error Handlers (กัน App ตายจาก Error นอก Express)
process.on('uncaughtException', (err) => {
    console.error('❌ CRITICAL: Uncaught Exception:', err);
    // พยายามส่ง log ไป monitor ก่อนตาย (ถ้ายังทำได้)
    broadcastLog({
        type: 'error',
        message: 'CRITICAL: Uncaught Exception: ' + err.message,
        time: new Date().toISOString()
    });
    // ปกติแนะนำให้ restart app (เช่นใช้ pm2) เพราะ state ของ app อาจจะเพี้ยนไปแล้ว
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    broadcastLog({
        type: 'error',
        message: 'Unhandled Rejection: ' + reason,
        time: new Date().toISOString()
    });
});