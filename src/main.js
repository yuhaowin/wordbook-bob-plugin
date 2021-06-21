/**
 * 单词本插件
 */

// 欧路单词本 ID
var EUDIC_WORD_BOOK_ID
var YOUDAO_ADD_WORD_URL = "http://dict.youdao.com/wordbook/ajax";
var EUDIC_ADD_WORD_URL = "https://api.frdic.com/api/open/v1/studylist/words";

function buildResult(res) {
    var result = {
        "from": "en",
        "to": "zh-Hans",
        "fromParagraphs": [
            "success add to word book"
        ],
        "toParagraphs": [res]
    }
    return result;
}

function buildError(res) {
    var result = {
        'type': 'param',
        'message': res,
        'addtion': '无'
    }
    return result;
}

// override
function supportLanguages() {
    return ['auto', 'zh-Hans', 'en'];
}

// override
function translate(query, completion) {
    var text = query.text;
    var fromLanguage = query.detectFrom;
    var selectDict = $option.selectDict;
    var authorization = $option.authorization;
    EUDIC_WORD_BOOK_ID = $option.wordbookId;

    if (fromLanguage != 'en' || text.search(' ') > 0) {
        completion({'result': buildResult("中文、非英语单词无需添加单词本")});
        return;
    }

    if (authorization) {
        addWord(selectDict, authorization, text, completion);
    } else {
        completion({'error': buildError('「认证信息」缺失')});
    }
}

function addWord(selectDict, authorization, word, completion) {
    if (selectDict == 1) { // 保存有道单词本
        addWordYoudao(authorization, word, completion);
    } else if (selectDict == 2) { // 保存欧路单词本
        if (EUDIC_WORD_BOOK_ID) {
            addWordEudic(authorization, word, completion);
        } else {
            queryEudicWordbookIds(authorization, completion)
        }
    }
}

function addWordEudic(token, word, completion) {
    $http.post({
        url: EUDIC_ADD_WORD_URL,
        header: {
            'Authorization': token,
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 11_1_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36'
        },
        body: {
            "id": EUDIC_WORD_BOOK_ID, // 单词本 id
            "language": "en",
            "words": [
                word
            ]
        },
        handler: function (res) {
            var data = res.data;
            var response = res.response;
            var statusCode = response.statusCode;
            if (statusCode === 201) {
                completion({'result': buildResult("添加单词本成功")});
            } else {
                completion({'error': buildError('token 已经过期，请重新获取。')});
                $log.info('addWord 接口返回值 data : ' + JSON.stringify(data));
            }
        }
    });
}

function addWordYoudao(cookie, word, completion) {
    $http.get({
        url: YOUDAO_ADD_WORD_URL,
        header: {
            'Host': 'dict.youdao.com',
            'Referer': 'http://dict.youdao.com/wordbook/wordlist?keyfrom=dict2.index',
            'Upgrade-Insecure-Requests': 1,
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 11_1_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36',
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Encoding': 'gzip, deflate',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            'Cookie': cookie
        },
        body: {
            'action': 'addword',
            'le': 'eng',
            'q': word
        },
        handler: function (res) {
            var data = res.data;
            var message = data.message;
            if (!message === 'nouser') {
                completion({'result': buildResult("添加单词本成功")});
            } else {
                completion({'error': buildError('cookie 已经过期，请重新获取。')});
                $log.info('addWord 接口返回值 data : ' + JSON.stringify(data));
            }
        }
    });
}

function queryEudicWordbookIds(token, completion) {
    $http.get({
        url: 'https://api.frdic.com/api/open/v1/studylist/category?language=en',
        header: {
            'Authorization': token,
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 11_1_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36'
        },
        handler: function (res) {
            var statusCode = res.response.statusCode;
            if (statusCode === 200) {
                var data = res.data.data;
                completion({'result': buildResult("单词本列表：\r\n" + JSON.stringify(data, null, 4))});
                $log.info('接口返回值 data : ' + JSON.stringify(data));
            } else {
                completion({'error': buildError('token 已经过期，请重新获取。')});
            }
        }
    });
}
