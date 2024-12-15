/**
 * 单词本插件
 */

// 有道单词本
var YOUDAO_ADD_WORD_URL = "https://dict.youdao.com/wordbook/webapi/v2/ajax/add?lan=en&word=";

// 扇贝单词本
var SHANBAY_ADD_WORD_URL = "https://apiv3.shanbay.com/wordscollection/words_bulk_upload"

// 欧路单词本
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
    var selected_dict = $option.dict_type;
    var authorization = $option.authorization;
    if (authorization) {
        doValidate(selected_dict, authorization, completion);
    } else {
        completion({
            result: false,
            error: {
                type: "secretKey",
                message: "未设置认证信息。",
                troubleshootingLink: "https://github.com/yuhaowin/wordbook-bob-plugin"
            }
        });
    }
}

function doValidate(selected_dict, authorization, completion) {

    // 验证欧路词典配置参数
    if (selected_dict == 2) {
        var wordbook_id = $option.wordbook_id
        if (!wordbook_id) {
            queryEudicWordbookIds(authorization, completion)
        } else {
            addWordEudic(authorization, 'test', wordbook_id, function (res) {
                if (201 === res.response.statusCode) {
                    completion({result: true});
                } else {
                    queryEudicWordbookIds(authorization, completion)
                }
            });
        }
    }
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
    var from_language = query.detectFrom;
    var selected_dict = $option.dict_type;
    var word_only = $option.word_only;
    var authorization = $option.authorization;
    var need_save = (word_only == 0 || text.search(' ') < 1);
    if (from_language != 'en' || !need_save) {
        completion({'result': buildResult("中文、非英语单词无需添加单词本")});
        return;
    }
    if (authorization) {
        addWord(selected_dict, authorization, text, completion);
    } else {
        completion({'error': buildError('「认证信息」缺失')});
    }
}

function addWord(selected_dict, authorization, word, completion) {
    if (selected_dict == 1) { // 保存有道单词本
        addWordYoudao(authorization, word, completion);
    }
    if (selected_dict == 2) { // 保存欧路单词本
        var wordbook_id = $option.wordbook_id;
        addWordEudic(authorization, word, wordbook_id, function (res) {
            if (201 === res.response.statusCode) {
                completion({'result': buildResult("添加单词成功")});
            } else {
                completion({'error': buildError('欧路词典 token 错误或过期，请重新填写。')});
                $log.info('addWord 接口返回值 data : ' + JSON.stringify(res.data));
            }
        });
    }
    if (selected_dict == 3) { // 保存扇贝单词本
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

function addWordEudic(token, word, wordbook_id, handler) {
    $http.post({
        url: EUDIC_ADD_WORD_URL,
        header: {
            'Authorization': token,
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 11_1_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36'
        },
        body: {
            "id": wordbook_id, // 单词本 id
            "language": "en",
            "words": [
                word
            ]
        },
        handler: handler
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
