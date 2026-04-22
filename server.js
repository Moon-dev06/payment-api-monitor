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
const MAX_LOGS = 200;

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
        // สำหรับ GET ให้เอา query มาโชว์เป็น body เพื่อให้เห็นข้อมูลบน monitor
        body: req.method === 'GET' ? req.query : (req.body || null),
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


const axios = require('axios');

// ตั้งค่า CPALL API Base URL (ควรใส่ไว้ใน .env)
const CPALL_URL = process.env.SPAC_BASE_URL; // ตัวอย่าง URL

// Middleware สำหรับจัดการ Error จาก Proxy
const handleProxyError = (err, res, logId, url) => {
    const errorData = err.response ? err.response.data : { message: err.message };
    const statusCode = err.response ? err.response.status : 500;

    addLog({
        id: logId,
        type: 'response',
        status: 'error',
        statusCode: statusCode,
        response: errorData,
        url: url,
        source: 'server-proxy'
    });

    res.status(statusCode).json(errorData);
};

// 🔐 [PROXY] GET TOKEN
app.get('/v2/payment/gettoken', async (req, res) => {
    const logId = res.locals.logId; // ดึง ID จาก middleware
    try {
        const response = await axios.get(`${CPALL_URL}/v2/payment/gettoken`, {
            headers: {
                'x-api-key': req.headers['x-api-key'],
                'channel': req.headers['channel']
            }
        });
        
        global.accessToken = response.data.result?.payload?.access_token;
        res.json(response.data);
    } catch (err) {
        handleProxyError(err, res, logId, req.originalUrl);
    }
});

// 🔍 [PROXY] INQUIRY
app.post('/payment/inquiryqrpayment', verifyToken, async (req, res) => {
    const logId = res.locals.logId;
    try {
        const response = await axios.post(`${CPALL_URL}/payment/inquiryqrpayment`, req.body, {
            headers: { 
                'Authorization': req.headers['authorization'],
                'channel': req.headers['channel']
            }
        });
        res.json(response.data);
    } catch (err) {
        handleProxyError(err, res, logId, req.originalUrl);
    }
});

// 💳 [PROXY] PAYMENT
app.post('/payment/payment', verifyToken, async (req, res) => {
    const logId = res.locals.logId;
    try {
        const response = await axios.post(`${CPALL_URL}/payment/payment`, req.body, {
            headers: { 
                'Authorization': req.headers['authorization'],
                'channel': req.headers['channel']
            }
        });
        res.json(response.data);
    } catch (err) {
        handleProxyError(err, res, logId, req.originalUrl);
    }
});

// 🔎 [PROXY] CHECK STATUS
app.get('/payment/checkpaymenttransaction', verifyToken, async (req, res) => {
    const logId = res.locals.logId;
    try {
        const response = await axios.get(`${CPALL_URL}/payment/checkpaymenttransaction`, {
            params: req.query,
            headers: { 
                'Authorization': req.headers['authorization'],
                'channel': req.headers['channel']
            }
        });
        res.json(response.data);
    } catch (err) {
        handleProxyError(err, res, logId, req.originalUrl);
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

// แก้จาก allLogs เป็น logs (ให้ตรงกับตัวแปรที่ใช้เก็บข้อมูลด้านบน)
app.delete('/logs/delete', (req, res) => {
    logs = []; // ล้างข้อมูลในตัวแปรหลักที่ใช้แสดงผล
    console.log("🗑️ All server logs cleared"); 
    res.status(200).send({ message: "All logs deleted successfully" });
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