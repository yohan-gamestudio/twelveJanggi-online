var express = require('express');
var app = express();
var http = require('http').createServer(app);
var io = require('socket.io')(http);
var fs = require('fs');

var text = fs.readFileSync('./public/script/new.js') + '';
eval(text);

app.use(express.static('public'));

app.get('/', function (req, res) {
    res.sendFile(__dirname + '/public/main.html');
});

app.get('/game.html', function (req, res) {
    res.sendFile(__dirname + '/public/game.html');
});

const ROOM_COUNT = 3000;
const RECONNECT_TIMEOUT_MS = 60000;

var room = Array(ROOM_COUNT);
var player = {};

for (var i = 0; i < ROOM_COUNT; i++) {
    room[i] = createRoom();
}

function createRoom() {
    return {
        p1: null,
        p2: null,
        p1_name: null,
        p2_name: null,
        p1_ready: false,
        p2_ready: false,
        started: false,
        game: new GAME(),
        p1_reconnect_deadline: 0,
        p2_reconnect_deadline: 0,
        p1_reconnect_timer: null,
        p2_reconnect_timer: null
    };
}

function resetRoomGame(r) {
    r.started = false;
    r.p1_ready = false;
    r.p2_ready = false;
    r.game = new GAME();
}

function clearReconnectState(r, slot) {
    var timerKey = (slot === 1) ? 'p1_reconnect_timer' : 'p2_reconnect_timer';
    var deadlineKey = (slot === 1) ? 'p1_reconnect_deadline' : 'p2_reconnect_deadline';

    if (r[timerKey]) {
        clearTimeout(r[timerKey]);
        r[timerKey] = null;
    }

    r[deadlineKey] = 0;
}

function hasActiveReconnectWindow(r) {
    var now = Date.now();
    return r.p1_reconnect_deadline > now || r.p2_reconnect_deadline > now;
}

function scheduleDisconnectCleanup(roomId, slot) {
    var r = room[roomId];
    if (!r) {
        return;
    }

    var timerKey = (slot === 1) ? 'p1_reconnect_timer' : 'p2_reconnect_timer';
    var deadlineKey = (slot === 1) ? 'p1_reconnect_deadline' : 'p2_reconnect_deadline';

    clearReconnectState(r, slot);

    var deadline = Date.now() + RECONNECT_TIMEOUT_MS;
    r[deadlineKey] = deadline;
    r[timerKey] = setTimeout(function () {
        var latestRoom = room[roomId];
        if (!latestRoom || latestRoom[deadlineKey] !== deadline) {
            return;
        }

        clearReconnectState(latestRoom, slot);

        if (slot === 1) {
            latestRoom.p1 = null;
            latestRoom.p1_name = null;
            latestRoom.p1_ready = false;
        }
        else {
            latestRoom.p2 = null;
            latestRoom.p2_name = null;
            latestRoom.p2_ready = false;
        }

        resetRoomGame(latestRoom);
        normalizeRoomSlots(latestRoom);

        emitRoomState(latestRoom);
        broadcastRoomList();
    }, RECONNECT_TIMEOUT_MS);
}

function tryReconnectPlayer(r, roomId, socketId, name) {
    var now = Date.now();
    var reconnected = false;

    if (r.p1_reconnect_deadline > now && r.p1_name === name) {
        clearReconnectState(r, 1);
        r.p1 = socketId;
        player[socketId] = [roomId, 1];
        reconnected = true;
    }
    else if (r.p2_reconnect_deadline > now && r.p2_name === name) {
        clearReconnectState(r, 2);
        r.p2 = socketId;
        player[socketId] = [roomId, 2];
        reconnected = true;
    }

    if (!reconnected) {
        return false;
    }

    if (r.p1 && r.p2) {
        r.p1_ready = true;
        r.p2_ready = true;
        r.started = true;
    }

    return true;
}

function swapRoomSides(r) {
    var tempP = r.p1;
    var tempName = r.p1_name;
    var tempReady = r.p1_ready;

    r.p1 = r.p2;
    r.p1_name = r.p2_name;
    r.p1_ready = r.p2_ready;

    r.p2 = tempP;
    r.p2_name = tempName;
    r.p2_ready = tempReady;

    if (player[r.p1]) {
        player[r.p1][1] = 1;
    }
    if (player[r.p2]) {
        player[r.p2][1] = 2;
    }
}

function normalizeRoomSlots(r) {
    if (!r.p1 && r.p2) {
        r.p1 = r.p2;
        r.p1_name = r.p2_name;
        r.p1_ready = r.p2_ready;
        if (player[r.p1]) {
            player[r.p1][1] = 1;
        }

        r.p2 = null;
        r.p2_name = null;
        r.p2_ready = false;
    }
}

function getUrlParams(url) {
    var params = {};
    url.replace(/[?&]+([^=&]+)=([^&]*)/gi, function (str, key, value) {
        params[key] = decodeURIComponent(value || '');
    });
    return params;
}

function parseJSON(msg) {
    if (typeof msg === 'string') {
        try {
            return JSON.parse(msg);
        }
        catch (e) {
            return null;
        }
    }

    if (msg && typeof msg === 'object') {
        return msg;
    }

    return null;
}

function parseRoomNumber(value) {
    var num = Number(value);
    if (!Number.isInteger(num)) {
        return null;
    }
    return num;
}

function getRandomEmptyRoomId() {
    var start = Math.floor(Math.random() * ROOM_COUNT);

    for (var i = 0; i < ROOM_COUNT; i++) {
        var idx = (start + i) % ROOM_COUNT;
        var r = room[idx];
        if (!r.p1 && !r.p2 && !r.started) {
            return idx;
        }
    }

    return null;
}

function getJoinableRoomList() {
    var list = [];

    for (var i = 0; i < ROOM_COUNT; i++) {
        var r = room[i];
        var count = (r.p1 ? 1 : 0) + (r.p2 ? 1 : 0);

        if (!r.started && count === 1 && !hasActiveReconnectWindow(r)) {
            list.push({
                val: i,
                p1_name: r.p1_name,
                p2_name: r.p2_name,
                count: count
            });
        }
    }

    return list;
}

function emitRoomState(r) {
    var payload = JSON.stringify({
        p1: r.p1,
        p2: r.p2,
        p1_name: r.p1_name,
        p2_name: r.p2_name,
        p1_ready: r.p1_ready,
        p2_ready: r.p2_ready,
        started: r.started,
        game: r.game
    });

    if (r.p1) {
        io.to(r.p1).emit('chat message', payload);
    }

    if (r.p2) {
        io.to(r.p2).emit('chat message', payload);
    }
}

function broadcastRoomList() {
    io.emit('room list', JSON.stringify(getJoinableRoomList()));
}

io.on('connection', function (socket) {
    console.log(socket.id + ' user connected');
    socket.emit('room list', JSON.stringify(getJoinableRoomList()));

    socket.on('request random room', function (msg) {
        var data = parseJSON(msg);
        var name = data && typeof data.name === 'string' ? data.name.trim() : '';

        if (!name) {
            socket.emit('room create result', JSON.stringify({
                ok: false,
                error: '이름을 입력해주세요.'
            }));
            return;
        }

        var roomId = getRandomEmptyRoomId();

        if (roomId === null) {
            socket.emit('room create result', JSON.stringify({
                ok: false,
                error: '생성 가능한 방이 없습니다.'
            }));
            return;
        }

        socket.emit('room create result', JSON.stringify({
            ok: true,
            val: roomId
        }));
    });

    socket.on('request room list', function () {
        socket.emit('room list', JSON.stringify(getJoinableRoomList()));
    });

    socket.on('player in', function (msg) {
        var data = getUrlParams(msg);
        var name = typeof data.name === 'string' ? data.name.trim() : '';
        var val = parseRoomNumber(data.val);

        if (!name || val === null || val < 0 || val >= ROOM_COUNT) {
            socket.emit('chat message', 'no');
            return;
        }

        if (player[socket.id]) {
            var joinedRoom = room[player[socket.id][0]];
            if (joinedRoom) {
                emitRoomState(joinedRoom);
            }
            return;
        }

        var r = room[val];

        if (tryReconnectPlayer(r, val, socket.id, name)) {
            emitRoomState(r);
            broadcastRoomList();
            return;
        }

        if (r.started || (r.p1 && r.p2)) {
            socket.emit('chat message', 'no');
            return;
        }

        var turn = 0;

        if (!r.p1) {
            r.p1 = socket.id;
            r.p1_name = name;
            r.p1_ready = true;
            clearReconnectState(r, 1);
            turn = 1;
        }
        else if (!r.p2) {
            r.p2 = socket.id;
            r.p2_name = name;
            r.p2_ready = true;
            clearReconnectState(r, 2);
            turn = 2;
        }

        if (!turn) {
            socket.emit('chat message', 'no');
            return;
        }

        player[socket.id] = [val, turn];

        if (r.p1 && r.p2) {
            resetRoomGame(r);

            if (Math.floor(Math.random() * 2) % 2 == 0) {
                swapRoomSides(r);
            }

            r.p1_ready = true;
            r.p2_ready = true;
            r.started = true;
        }

        emitRoomState(r);
        broadcastRoomList();
    });


    socket.on('game input', function (msg) {
        var data = parseJSON(msg);

        if (!data || !player[socket.id]) {
            return;
        }

        var val = player[socket.id][0];
        var turn = player[socket.id][1];
        var r = room[val];

        if (!r || !r.started) {
            return;
        }

        var game = r.game;

        if (game.button_click(turn, data) == MOVED) {
            if (game.turn == 1) {
                game.set_turn(2);
            }
            else {
                game.set_turn(1);
            }
        }

        emitRoomState(r);

        if (game.state == PLAYER1) {
            io.to(r.p1).emit('chat message', 'p1');
            io.to(r.p2).emit('chat message', 'p1');

            swapRoomSides(r);
            resetRoomGame(r);
            emitRoomState(r);
            broadcastRoomList();
        }
        else if (game.state == PLAYER2) {
            io.to(r.p1).emit('chat message', 'p2');
            io.to(r.p2).emit('chat message', 'p2');

            swapRoomSides(r);
            resetRoomGame(r);
            emitRoomState(r);
            broadcastRoomList();
        }
    });

    socket.on('disconnect', function () {
        console.log(socket.id + ' user disconnected');

        if (!player[socket.id]) {
            return;
        }

        var val = player[socket.id][0];
        var turn = player[socket.id][1];
        var r = room[val];

        delete player[socket.id];

        if (!r) {
            return;
        }

        if (turn === 1 && r.p1 === socket.id) {
            r.p1 = null;
            r.p1_ready = false;
            scheduleDisconnectCleanup(val, 1);
        }
        else if (turn === 2 && r.p2 === socket.id) {
            r.p2 = null;
            r.p2_ready = false;
            scheduleDisconnectCleanup(val, 2);
        }
        else {
            return;
        }

        resetRoomGame(r);
        emitRoomState(r);
        broadcastRoomList();
    });
});

http.listen(9200, function () {
    console.log('Server start on 9200');
});
