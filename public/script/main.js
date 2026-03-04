var game = new GAME();
var turn = PLAYER1;
var start = false;
var roomId = null;

var socket = io();
socket.emit('player in', window.location.href);

function parseQuery() {
    var params = {};
    var query = window.location.search.replace(/^\?/, '');

    if (!query) {
        return params;
    }

    query.split('&').forEach(function (pair) {
        var chunks = pair.split('=');
        var key = chunks[0];
        var value = chunks.length > 1 ? chunks.slice(1).join('=') : '';

        params[decodeURIComponent(key)] = decodeURIComponent(value);
    });

    return params;
}

function updateRoomInfo() {
    if (roomId === null) {
        $('#room-info').text('방 번호: -');
    }
    else {
        $('#room-info').text('방 번호: ' + roomId);
    }
}

function updateStatus(res) {
    if (!res.p1 || !res.p2) {
        $('#status-text').text('상대를 기다리는 중...');
        $('#ready-btn').prop('disabled', true);
        return;
    }

    if (!res.started) {
        var p1Ready = res.p1_ready ? '레디' : '대기';
        var p2Ready = res.p2_ready ? '레디' : '대기';
        $('#status-text').text('P1: ' + p1Ready + ' / P2: ' + p2Ready);

        var mineReady = (turn === PLAYER1 && res.p1_ready) || (turn === PLAYER2 && res.p2_ready);
        $('#ready-btn').prop('disabled', mineReady);
        return;
    }

    $('#status-text').text('게임 진행 중');
    $('#ready-btn').prop('disabled', true);
}

socket.on('chat message', function (msg) {
    if (msg === 'no') {
        alert('방을 들어갈 수 없습니다.');
        window.location.href = '/';
        return;
    }

    if (msg === 'p1') {
        alert($('#name1').text() + ' 플레이어가 이겼습니다.');
        start = false;
        $('#ready-btn').prop('disabled', false);
        return;
    }

    if (msg === 'p2') {
        alert($('#name2').text() + ' 플레이어가 이겼습니다.');
        start = false;
        $('#ready-btn').prop('disabled', false);
        return;
    }

    var res;

    try {
        res = JSON.parse(msg);
    }
    catch (e) {
        return;
    }

    if (!res || !res.game) {
        return;
    }

    var tmp = res.game;
    game.turn = tmp.turn;
    game.state = tmp.state;
    game.player1 = tmp.player1;
    game.player2 = tmp.player2;
    game.board = tmp.board;
    game.selected = tmp.selected;

    turn = res.p1 === socket.id ? PLAYER1 : PLAYER2;
    start = !!res.started;

    $('#name1').text(res.p1_name ? decodeURI(res.p1_name) : '플레이어1');
    $('#name2').text(res.p2_name ? decodeURI(res.p2_name) : '플레이어2');

    updateStatus(res);
    refresh();
});

$('document').ready(function () {
    var params = parseQuery();
    roomId = params.val ? Number(params.val) : null;
    updateRoomInfo();

    $('#ready-btn').on('click', function () {
        socket.emit('player ready');
        $('#ready-btn').prop('disabled', true);
    });

    game.set_turn(turn);
    refresh();
});

function player1(x) {
    if (!start || turn !== PLAYER1) {
        return;
    }

    socket.emit('game input', JSON.stringify(new POS(HAVING, x, 0)));
}

function player2(x) {
    if (!start || turn !== PLAYER2) {
        return;
    }

    socket.emit('game input', JSON.stringify(new POS(HAVING, x, 0)));
}

function button_yx(y, x) {
    if (!start) {
        return;
    }

    socket.emit('game input', JSON.stringify(new POS(BOARD, y, x)));
}

function refresh() {
    var p1 = game.get_having(PLAYER1);
    var p2 = game.get_having(PLAYER2);
    var bd = game.get_board();

    var screen_bd = $('#btn > img');
    var screen_p1 = $('#player1 > #sbtn > img');
    var screen_p2 = $('#player2 > #sbtn > img');

    for (var i = 0; i < 6; i++) {
        screen_p1[i].src = 'images/' + mal_str(p1[i]) + '.png';
        screen_p2[i].src = 'images/' + mal_str(p2[i]) + '.png';
    }

    for (var y = 0; y < 4; y++) {
        for (var x = 0; x < 3; x++) {
            screen_bd[y * 3 + x].src = 'images/' + mal_str(bd[y][x]) + '.png';
        }
    }

    if (game.turn === PLAYER1) {
        $('#turn1').css({'background': 'rgba(245,200,66,0.22)', 'color': '#f5c842'});
        $('#turn2').css({'background': 'rgba(0,0,0,0.18)', 'color': '#5e5a52'});
    }
    else {
        $('#turn1').css({'background': 'rgba(0,0,0,0.18)', 'color': '#5e5a52'});
        $('#turn2').css({'background': 'rgba(245,200,66,0.22)', 'color': '#f5c842'});
    }
}

function mal_str(mal) {
    var ret = '';

    if (mal == null) {
        return '빈칸';
    }

    if (mal.player === NOTHING) {
        if (mal.pos.y === 0) {
            ret = '빨빈';
        }
        else if (mal.pos.y === 3) {
            ret = '초빈';
        }
        else {
            if (mal.highlighted) {
                return '빈칸선';
            }
            return '빈칸';
        }
    }
    else {
        if (mal.player === PLAYER1) {
            ret = '초';
        }
        else if (mal.player === PLAYER2) {
            ret = '빨';
        }

        if (mal.type === Ja) {
            ret += '자';
        }
        else if (mal.type === Jang) {
            ret += '장';
        }
        else if (mal.type === Sang) {
            ret += '상';
        }
        else if (mal.type === Wang) {
            ret += '왕';
        }
        else if (mal.type === Hu) {
            ret += '후';
        }
    }

    if (mal.highlighted) {
        ret += '선';
    }
    else {
        ret += '무';
    }

    return ret;
}
