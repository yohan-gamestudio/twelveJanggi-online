var game = new GAME();
var turn = PLAYER1;
var start = false;
var roomId = null;

var socket = io();
socket.emit('player in', window.location.href);

var IMAGE_PATH_PREFIX = 'images/';
var PRELOAD_IMAGE_NAMES = [
    '빈칸', '빈칸선',
    '빨빈무', '빨빈선', '빨상무', '빨상선', '빨왕무', '빨왕선', '빨자무', '빨자선', '빨장무', '빨장선', '빨후무', '빨후선',
    '초빈무', '초빈선', '초상무', '초상선', '초왕무', '초왕선', '초자무', '초자선', '초장무', '초장선', '초후무', '초후선'
];

var renderNodes = null;
var renderState = {
    myPieces: new Array(6),
    oppPieces: new Array(6),
    board: new Array(12),
    boardFlipped: null,
    myTurn: null
};
var renderScheduled = false;
var raf = window.requestAnimationFrame || function (callback) {
    return setTimeout(callback, 16);
};

function toImagePath(name) {
    return IMAGE_PATH_PREFIX + name + '.png';
}

function ensureRenderNodes() {
    if (renderNodes && renderNodes.board.length === 12 && renderNodes.my.length === 6 && renderNodes.opp.length === 6) {
        return true;
    }

    var next = {
        board: document.querySelectorAll('#board > #btn > img'),
        my: document.querySelectorAll('#player1 > #sbtn > img'),
        opp: document.querySelectorAll('#player2 > #sbtn > img')
    };

    if (next.board.length !== 12 || next.my.length !== 6 || next.opp.length !== 6) {
        return false;
    }

    renderNodes = next;
    return true;
}

function preloadPieceImages() {
    for (var i = 0; i < PRELOAD_IMAGE_NAMES.length; i++) {
        var image = new Image();
        image.src = toImagePath(PRELOAD_IMAGE_NAMES[i]);
    }
}

function setImageIfChanged(imageNode, cache, index, nextImageName) {
    if (!imageNode || cache[index] === nextImageName) {
        return;
    }

    cache[index] = nextImageName;
    imageNode.src = toImagePath(nextImageName);
}

function applyTurnStyles(myTurn) {
    if (renderState.myTurn === myTurn) {
        return;
    }

    renderState.myTurn = myTurn;

    var activeStyle = {'background': 'rgba(245,200,66,0.22)', 'color': '#f5c842'};
    var inactiveStyle = {'background': 'rgba(0,0,0,0.18)', 'color': '#5e5a52'};
    $('#turn1').css(myTurn ? activeStyle : inactiveStyle);
    $('#turn2').css(myTurn ? inactiveStyle : activeStyle);
}

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

    if (turn === PLAYER2) {
        $('#name1').text(res.p2_name ? decodeURI(res.p2_name) : '플레이어2');
        $('#name2').text(res.p1_name ? decodeURI(res.p1_name) : '플레이어1');
        // 색: 내가(player2) 아래 → 아래 바는 빨간색, 위는 초록색
        $('#name1').css({'background': 'var(--bg-player2)', 'color': 'var(--player2-accent)', 'border-left': '3px solid var(--player2-accent)', 'border-right': 'none'});
        $('#name2').css({'background': 'var(--bg-player1)', 'color': 'var(--player1-accent)', 'border-left': 'none', 'border-right': '3px solid var(--player1-accent)'});
    } else {
        $('#name1').text(res.p1_name ? decodeURI(res.p1_name) : '플레이어1');
        $('#name2').text(res.p2_name ? decodeURI(res.p2_name) : '플레이어2');
    }

    updateStatus(res);
    requestRefresh();
});

$('document').ready(function () {
    var params = parseQuery();
    roomId = params.val ? Number(params.val) : null;
    updateRoomInfo();

    preloadPieceImages();

    $('#ready-btn').on('click', function () {
        socket.emit('player ready');
        $('#ready-btn').prop('disabled', true);
    });

    game.set_turn(turn);
    requestRefresh();
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

function bottom_piece_click(x) {
    if (turn === PLAYER1) player1(x);
    else player2(x);
}

function button_yx(y, x) {
    if (!start) {
        return;
    }

    var actual_y = (turn === PLAYER2) ? 3 - y : y;
    var actual_x = (turn === PLAYER2) ? 2 - x : x;
    socket.emit('game input', JSON.stringify(new POS(BOARD, actual_y, actual_x)));
}

function requestRefresh() {
    if (renderScheduled) {
        return;
    }

    renderScheduled = true;

    raf(function () {
        renderScheduled = false;
        refresh();
    });
}

function refresh() {
    if (!ensureRenderNodes()) {
        return;
    }

    var p1 = game.get_having(PLAYER1);
    var p2 = game.get_having(PLAYER2);
    var bd = game.get_board();

    var myPieces = (turn === PLAYER2) ? p2 : p1;
    var oppPieces = (turn === PLAYER2) ? p1 : p2;

    for (var i = 0; i < 6; i++) {
        setImageIfChanged(renderNodes.my[i], renderState.myPieces, i, mal_str(myPieces[i]));
        setImageIfChanged(renderNodes.opp[i], renderState.oppPieces, i, mal_str(oppPieces[i]));
    }

    var shouldFlip = (turn === PLAYER2);
    if (renderState.boardFlipped !== shouldFlip) {
        renderState.boardFlipped = shouldFlip;
        if (shouldFlip) {
            $('#board').addClass('flipped');
            $('#wrap').addClass('hands-flipped');
        }
        else {
            $('#board').removeClass('flipped');
            $('#wrap').removeClass('hands-flipped');
        }
    }

    for (var y = 0; y < 4; y++) {
        for (var x = 0; x < 3; x++) {
            var sy = shouldFlip ? 3 - y : y;
            var sx = shouldFlip ? 2 - x : x;
            var idx = y * 3 + x;
            setImageIfChanged(renderNodes.board[idx], renderState.board, idx, mal_str(bd[sy][sx]));
        }
    }

    applyTurnStyles(game.turn === turn);
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
