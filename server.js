const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server);

// Check if public/ folder exists, if not serve from root
const publicDir = path.join(__dirname, 'public');
const hasPublic = fs.existsSync(publicDir);

if (hasPublic) {
  app.use(express.static(publicDir));
} else {
  app.use(express.static(__dirname));
}

// In-memory data store
const data = {
  votes: [],
  round2Votes: [],
  connections: new Set(),
  startTime: Date.now(),
  thinkTimes: {
    lars: [],
    youssef: [],
    sem: [],
    shane: []
  }
};

// Routes - flexible for both public/ and root layouts
function serveFile(res, filename) {
  const publicPath = path.join(__dirname, 'public', filename);
  const rootPath = path.join(__dirname, filename);
  
  if (fs.existsSync(publicPath)) {
    res.sendFile(publicPath);
  } else if (fs.existsSync(rootPath)) {
    res.sendFile(rootPath);
  } else {
    res.status(404).send(`${filename} not found`);
  }
}

app.get('/', (req, res) => {
  serveFile(res, 'index.html');
});

app.get('/results', (req, res) => {
  serveFile(res, 'results.html');
});

// QR code endpoint
app.get('/qr', async (req, res) => {
  try {
    const baseUrl = req.protocol + '://' + req.get('host');
    const qrImage = await QRCode.toBuffer(baseUrl, {
      width: 400,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': qrImage.length
    });
    res.end(qrImage);
  } catch (err) {
    console.error('QR generation error:', err);
    res.status(500).send('Error generating QR');
  }
});

// API endpoint for current stats
app.get('/api/stats', (req, res) => {
  res.json(getStats());
});

function getStats() {
  const round1 = { lars: 0, youssef: 0, total: 0, avgThinkTime: 0, larsAvgTime: 0, youssefAvgTime: 0 };
  const round2 = { sem: 0, shane: 0, total: 0, avgThinkTime: 0, semAvgTime: 0, shaneAvgTime: 0 };
  
  data.votes.forEach(v => {
    if (v.candidate === 'lars') round1.lars++;
    else round1.youssef++;
    round1.total++;
  });
  
  data.round2Votes.forEach(v => {
    if (v.candidate === 'sem') round2.sem++;
    else round2.shane++;
    round2.total++;
  });

  if (round1.total > 0) {
    round1.avgThinkTime = data.votes.reduce((sum, v) => sum + v.thinkTime, 0) / round1.total;
    round1.larsPercent = Math.round((round1.lars / round1.total) * 100);
    round1.youssefPercent = Math.round((round1.youssef / round1.total) * 100);
  } else {
    round1.larsPercent = 0;
    round1.youssefPercent = 0;
  }

  if (round2.total > 0) {
    round2.avgThinkTime = data.round2Votes.reduce((sum, v) => sum + v.thinkTime, 0) / round2.total;
    round2.semPercent = Math.round((round2.sem / round2.total) * 100);
    round2.shanePercent = Math.round((round2.shane / round2.total) * 100);
  } else {
    round2.semPercent = 0;
    round2.shanePercent = 0;
  }

  const avg = (arr) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  round1.larsAvgTime = avg(data.thinkTimes.lars);
  round1.youssefAvgTime = avg(data.thinkTimes.youssef);
  round2.semAvgTime = avg(data.thinkTimes.sem);
  round2.shaneAvgTime = avg(data.thinkTimes.shane);

  return {
    round1,
    round2,
    totalConnections: data.connections.size,
    uptime: Math.floor((Date.now() - data.startTime) / 1000)
  };
}

io.on('connection', (socket) => {
  data.connections.add(socket.id);
  console.log(`Connected: ${socket.id} (total: ${data.connections.size})`);

  socket.emit('stats', getStats());

  socket.on('vote:round1', (data_vote) => {
    const vote = {
      candidate: data_vote.candidate,
      thinkTime: data_vote.thinkTime,
      timestamp: Date.now(),
      id: socket.id
    };
    
    const existing = data.votes.find(v => v.id === socket.id);
    if (existing) {
      const oldTimes = data.thinkTimes[existing.candidate];
      const idx = oldTimes.indexOf(existing.thinkTime);
      if (idx > -1) oldTimes.splice(idx, 1);
      existing.candidate = vote.candidate;
      existing.thinkTime = vote.thinkTime;
    } else {
      data.votes.push(vote);
    }
    
    data.thinkTimes[vote.candidate].push(vote.thinkTime);
    const stats = getStats();
    io.emit('stats', stats);
    socket.emit('vote:confirmed', { candidate: vote.candidate, thinkTime: vote.thinkTime });
    console.log(`Round 1 vote: ${vote.candidate} (${(vote.thinkTime/1000).toFixed(1)}s)`);
  });

  socket.on('vote:round2', (data_vote) => {
    const vote = {
      candidate: data_vote.candidate,
      thinkTime: data_vote.thinkTime,
      timestamp: Date.now(),
      id: socket.id
    };
    
    const existing = data.round2Votes.find(v => v.id === socket.id);
    if (existing) {
      const oldTimes = data.thinkTimes[existing.candidate];
      const idx = oldTimes.indexOf(existing.thinkTime);
      if (idx > -1) oldTimes.splice(idx, 1);
      existing.candidate = vote.candidate;
      existing.thinkTime = vote.thinkTime;
    } else {
      data.round2Votes.push(vote);
    }
    
    data.thinkTimes[vote.candidate].push(vote.thinkTime);
    const stats = getStats();
    io.emit('stats', stats);
    socket.emit('vote:confirmed', { candidate: vote.candidate, thinkTime: vote.thinkTime });
    console.log(`Round 2 vote: ${vote.candidate} (${(vote.thinkTime/1000).toFixed(1)}s)`);
  });

  socket.on('admin:reset', () => {
    data.votes = [];
    data.round2Votes = [];
    data.thinkTimes = { lars: [], youssef: [], sem: [], shane: [] };
    data.startTime = Date.now();
    io.emit('stats', getStats());
    console.log('Data reset by admin');
  });

  socket.on('disconnect', () => {
    data.connections.delete(socket.id);
    console.log(`Disconnected: ${socket.id} (total: ${data.connections.size})`);
    io.emit('stats', getStats());
  });
});

// Use PORT from environment or default to 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`StageMatch NL server running on port ${PORT}`);
  console.log(`Student site: http://0.0.0.0:${PORT}/`);
  console.log(`Results dashboard: http://0.0.0.0:${PORT}/results`);
});
