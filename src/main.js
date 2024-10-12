/**
 * 单词本插件
 */

// 有道单词本
var YOUDAO_ADD_WORD_URL = "https://dict.youdao.com/wordbook/webapi/v2/ajax/add?lan=en&word=";

// 扇贝单词本
var SHANBAY_ADD_WORD_URL = "https://apiv3.shanbay.com/wordscollection/words_bulk_upload"

// 欧路单词本 ID
var EUDIC_WORD_BOOK_ID
var EUDIC_ADD_WORD_URL = "https://api.frdic.com/api/open/v1/studylist/words";
var EUDIC_BOOK_LIST_URL = "https://api.frdic.com/api/open/v1/studylist/category?language=en";

function buildResult(res) {
    var result = {
        "from": "en",
        "to": "zh-Hans",
        "toParagraphs": [res],
        "fromParagraphs": [
            "success add to word book"
        ]
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
    return ['zh-Hans', 'en'];
}

// override
function pluginValidate(completion) {
    var authorization = $option.authorization;
    var dict_type = $option.dict_type;
    var wordbook_id = $option.wordbook_id
    if (!authorization) {
        completion({
            result: false,
            error: {
                type: "secretKey",
                message: "未设置认证信息。",
                troubleshootingLink: "https://github.com/yuhaowin/wordbook-bob-plugin"
            }
        });
        return;
    }
    if (dict_type == 2 && !wordbook_id) {
        queryEudicWordbookIds(authorization, completion)
        return
    }
    completion({result: true});
}

function queryEudicWordbookIds(token, completion) {
    $http.get({
        url: EUDIC_BOOK_LIST_URL,
        header: {
            'Authorization': token,
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 11_1_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36'
        },
        handler: function (res) {
            var statusCode = res.response.statusCode;
            if (statusCode === 200) {
                var data = res.data.data;
                completion({
                    result: false,
                    error: {
                        type: "param",
                        message: "请选择欧路词典单词本 id : \r\n" + JSON.stringify(data, null, 4)
                    }
                });
            } else {
                completion({
                    result: false,
                    error: {
                        type: "param",
                        message: "欧路词典 token 错误或过期，请重新填写。",
                        troubleshootingLink: "https://github.com/yuhaowin/wordbook-bob-plugin"
                    }
                });
                $log.info('接口返回值 data : ' + JSON.stringify(data));
            }
        }
    });
}

// override
function translate(query, completion) {
    var text = query.text;
    var fromLanguage = query.detectFrom;
    var selectDict = $option.dict_type;
    var word_only = $option.word_only;
    var authorization = $option.authorization;
    EUDIC_WORD_BOOK_ID = $option.wordbook_id;
    var need_save = (word_only == 0 || text.search(' ') < 1);
    if (fromLanguage != 'en' || !need_save) {
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
    }
    if (selectDict == 2) { // 保存欧路单词本
        addWordEudic(authorization, word, completion);
    }
    if (selectDict == 3) { // 保存扇贝单词本
        addWordShanbay(authorization, word, completion);
    }
}

function addWordYoudao(cookie, word, completion) {
    $http.get({
        url: YOUDAO_ADD_WORD_URL + encodeURIComponent(word),
        header: {
            'Cookie': cookie,
            'Host': 'dict.youdao.com',
            'Upgrade-Insecure-Requests': 1,
            'Accept-Encoding': 'gzip, deflate',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            'Accept': 'application/json, text/plain, */*',
            'Referer': 'https://dict.youdao.com',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 11_1_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36'
        },
        handler: function (res) {
            var data = res.data;
            if (data.code === 0) {
                completion({'result': buildResult("添加单词成功")});
            } else {
                completion({'error': buildError('有道词典 cookie 错误或过期，请重新填写。')});
                $log.info('addWord 接口返回值 data : ' + JSON.stringify(data));
            }
        }
    });
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
                completion({'result': buildResult("添加单词成功")});
            } else {
                completion({'error': buildError('欧路词典 token 错误或过期，请重新填写。')});
                $log.info('addWord 接口返回值 data : ' + JSON.stringify(data));
            }
        }
    });
}

function addWordShanbay(token, word, completion) {
    $http.post({
        url: SHANBAY_ADD_WORD_URL,
        header: {
            "Cookie": `auth_token=${token}`,
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 11_1_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36'
        },
        body: {
            "business_id": 6,
            "words": [
                word
            ]
        },
        handler: function (res) {
            if (res.response.statusCode === 200) {
                completion({'result': buildResult("添加单词本成功")});
            } else {
                completion({'error': buildError('扇贝词典 auth_token 错误或过期，请重新填写。')});
                $log.info('接口返回值 data : ' + JSON.stringify(data));
            }
        }
    });
}
