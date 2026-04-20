require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

app.use(express.static(path.join(__dirname, 'public')));
app.use(cors());
app.use(express.json());

// 🧠 เก็บ logs (In-memory สำหรับทดสอบบน Vercel ชั่วคราว)
let logs = [];
const MAX_LOGS = 50;

// ฟังก์ชันเก็บ log
function addLog(logData) {
    const log = {
        ...logData,
        id: logData.id || Date.now() + Math.random().toString(36).substr(2, 9),
        time: logData.time || new Date().toISOString()
    };
    
    console.log(`📝 Log added: ${log.type} for: ${log.url || 'N/A'}`);
    
    logs.push(log);
    
    // จำกัดจำนวนเพื่อไม่ให้ Memory เต็มบน Serverless
    if (logs.length > MAX_LOGS) {
        logs.shift();
    }
}

// Endpoint สำหรับดึง logs (Polling)
app.get('/logs', (req, res) => {
    // บน Vercel ข้อมูลนี้จะหายไปเมื่อแอป Sleep
    res.json(logs);
});

// Logging Middleware
app.use((req, res, next) => {
    // ข้าม favicon, ไฟล์ static และทุกอย่างที่เป็นการรับ log เอง
    if (
        req.originalUrl === '/favicon.ico' || 
        req.originalUrl.startsWith('/js/') || 
        req.originalUrl.startsWith('/logs')
    ) {
        return next();
    }

    const startTime = Date.now();
    const logId = Date.now() + Math.random().toString(36).substr(2, 9);

    // ดักจับ response body ให้แม่นยำขึ้น
    const oldSend = res.send;
    res.send = function (data) {
        res.locals.responseBody = data;
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
        status: "processing",
        source: 'server'
    };

    addLog(requestLog);

    // ส่งตอนจบ (Response)
    res.on('finish', () => {
        let rawBody = res.locals.responseBody;
        let parsedResBody = rawBody;

        // ถ้าเป็น Buffer ให้แปลงเป็น String ก่อน
        if (Buffer.isBuffer(rawBody)) {
            parsedResBody = rawBody.toString('utf8');
        }

        // พยายาม Parse เป็น JSON ถ้าทำได้
        try {
            if (typeof parsedResBody === 'string') {
                parsedResBody = JSON.parse(parsedResBody);
            }
        } catch (e) {
            // ไม่ใช่ JSON หรือ Parse ไม่สำเร็จ ให้ใช้ค่าเดิม
        }

        const responseLog = {
            id: logId,
            status: "done",
            statusCode: res.statusCode,
            duration: Date.now() - startTime,
            response: parsedResBody,
            type: 'response',
            url: req.originalUrl,
            source: 'server'
        };

        addLog(responseLog);
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

    addLog({
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
    addLog(log); 

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
    addLog(log);

    res.json({ success: true });
});

// 🚀 START SERVER
const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Server running on port ${PORT}`);
    });
}

module.exports = app;


//กัน App ตายจาก Error นอก Express (เช่น Promise ที่ไม่ได้ catch)
// 🛠 Global Express Error Handler (ควรอยู่ท้ายสุดของ routes)
app.use((err, req, res, next) => {
    console.error('❌ Express Error:', err.stack);

    addLog({
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
    addLog({
        type: 'error',
        message: 'CRITICAL: Uncaught Exception: ' + err.message,
        time: new Date().toISOString()
    });
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    addLog({
        type: 'error',
        message: 'Unhandled Rejection: ' + reason,
        time: new Date().toISOString()
    });
});