# youdao-wordbook-bob-plugin

>这是一个 [Bob](https://github.com/ripperhe/Bob) 的翻译插件，但是该插件不对输入的文本进行翻译，听起来不可思议，但的确如此，该插件主要是将输入的英文单词通过接口
>的方式同步到 `有道词典` 的单词本中，以方便对查询过的单词进行集中复习。

## 特性
>仅实现了通过 cookie 的方式添加单词到单词本；无法使用账号登录，因为 Bob 提供的 API 无法获取到请求返回的 cookie。[issue 115](https://github.com/ripperhe/Bob/issues/115)

## 安装

![](imgs/013421.png)

## 获取 cookie
1、[web 登录有道词典](http://account.youdao.com/login)

2、如下图操作：

![](imgs/141451.png)

3、在控制台执行 `document.cookie`


## 效果
1、电脑查询

![](imgs/013250.png)

2、手机查看

![](imgs/013723.png)
