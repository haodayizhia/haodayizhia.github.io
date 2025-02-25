+++
date = '2025-02-24T23:41:17+08:00'
draft = false
title = 'My 1st post'
description = '自动部署TLS/Xray教程简洁版'
+++
# 自动部署TLS/Xray教程简洁版
- [自动部署TLS/Xray教程简洁版](#自动部署tlsxray教程简洁版)
  - [Step 1 准备工作](#step-1-准备工作)
  - [Step 2 配置部分](#step-2-配置部分)
  - [Step 3 启动服务](#step-3-启动服务)
  - [Appendix 附加说明](#appendix-附加说明)
    - [一、certbot 证书续签](#一certbot-证书续签)
      - [手动续签](#手动续签)
      - [自动续签](#自动续签)
    - [二、其他问题](#二其他问题)
    - [三、参考链接](#三参考链接)

---
## Step 1 准备工作

- 自行购买境外VPS，推荐 **AWS EC2**，首次注册绑定 VISA 信用卡可免费使用一年。
>**什么是 AWS Free Tier？**
>AWS Free Tier 使客户能够在各服务的指定限制内免费探索和试用 AWS 服务。免费套餐包含三种不同类型的产品、12 个月免费试用、永久免费和短期免费试用。12 个月免费服务允许客户自账户激活之日起一年内在指定限制内免费使用该产品。永久免费服务允许 AWS 客户在指定限制内免费使用该产品。根据所选服务，短期试用服务可以在指定的时间段内免费使用，或者免费使用一次。有关免费提供的服务和相应的限制，在 Free Tier 页面的每张卡片中有详细说明。如果您的应用程序使用量超过了 Free Tier 限制，您只需支付标准的按需付费服务费率（请参阅服务页面获取完整的定价信息）。存在限制条件；有关更多详细信息，请参阅优惠条款。

- 准备一个域名（推荐腾讯云、阿里云等），示例使用 `example.com`。


- 将域名托管到 [cloudflare](https://dash.cloudflare.com/)，然后解析到服务器 IP。

---

## Step 2 配置部分

在服务器终端上逐条运行以下命令，请自行`sudo`：

```bash
# 更新软件包列表
apt update
# 安装Xray-core
bash -c "$(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install
# 覆盖Xray-core配置
vim /usr/local/etc/xray/config.json
# 安装certbot和nginx
apt install certbot
apt install nginx
# certbot申请证书
certbot certonly
# 覆盖nginx配置
vim /etc/nginx/conf.d/v2ray.conf
# 替换配置中的域名
# echo -n "新域名："
# read newDomain
# sed -i "s/example.com/$newDomain/g" /etc/nginx/conf.d/v2ray.conf
```
其中，`config.json`文件内容如下：
```json
{
  "inbounds": [{
    "port": 10086,           //端口范围0至65535，请确保和nginx的端口号一致
    "listen":"127.0.0.1",
    "protocol": "vmess",
    "settings": {
      "clients": [
        {
          "id": "41747268-f36b-416f-b68b-2f8e69fa472b", //此处为安装时生成的id
          "level": 1,
          "alterId": 0      //此处为安装时生成的alterId
        }
      ]
    },
    "streamSettings": {
      "network": "ws",
      "wsSettings": {
        "path": "/ray"   //此处为路径，需要和下面NGINX上面的路径配置一样
      }
    }
  }],
  "outbounds": [{
    "protocol": "freedom",
    "settings": {}
  },{
    "protocol": "blackhole",
    "settings": {},
    "tag": "blocked"
  }],
  "routing": {
    "rules": [
      {
        "type": "field",
        "ip": ["geoip:private"],
        "outboundTag": "blocked"
      }
    ]
  }
}
```
`v2ray.conf`文件内容
```nginx
server {
    listen       443 ssl;
    server_name  example.com;                  # 修改为自己的域名

    ssl_certificate      /etc/letsencrypt/live/example.com/fullchain.pem;  # 将example.com修改为自己的域名
    ssl_certificate_key  /etc/letsencrypt/live/example.com/privkey.pem;    # 将example.com修改为自己的域名

    location /ray {                        # 修改为你自己的路径，需要和V2RAY里面的路径一样
        proxy_redirect off;
        proxy_pass http://127.0.0.1:10086; # 修改为你自己的v2ray服务器端口，就是这里需要和上面V2RAY配置文件里面的端口号相同。
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_connect_timeout 60s;
        proxy_read_timeout 86400s;
        proxy_send_timeout 60s;
    }
}
```
---
## Step 3 启动服务

```bash
# 启动/停止/查看v2ray服务
systemctl start/stop/status v2ray
# 检测nginx配置是否正确
nginx -t
# 启动/停止/查询nginx服务
systemctl start/stop/status nginx
```
---
## Appendix 附加说明
### 一、certbot 证书续签
certbot证书可以手动续签和自动续签，自动续签方式有两种：系统服务 systemd 或创建 crontab 周期任务。
#### 手动续签

```bash
sudo certbot certificates	# 证书有效期查询
sudo systemctl stop nginx	# 关闭nginx，解除占用端口
sudo certbot renew			# 续签证书
sudo systemctl restart nginx	# 重启nginx
```
#### 自动续签

1. `systemd`服务单元文件

前面提到certbot默认不会在运行了`systemd`的系统上通过`crontab`自动续签，通过`systemctl`管理。

```bash
# 启动/查看服务
sudo systemctl start/status certbot.service     # 查看certbot服务
sudo systemctl start/status certbot.timer   # 查看certbot的定时器
```

这两个服务的配置文件路径通常在：`/lib/systemd/system/certbot.service`和`/lib/systemd/system/certbot.timer`。

如果启用了服务却没有自动续签，查看系统日志：
```bash
sudo journalctl -u certbot
```
报错显示我是因为开启nginx占用了端口导致的，有三种修改方法：

- 使用`/etc/sysconfig/certbot`设置 Hook（推荐）

如果`/etc/sysconfig/certbot`文件已在`certbot-renew.service`中定义为`EnvironmentFile`，可以直接在该文件中添加 `PRE_HOOK`和`POST_HOOK`变量。

```bash
vim /etc/sysconfig/certbot
# 添加以下内容
PRE_HOOK="--pre-hook 'systemctl stop nginx'"
POST_HOOK="--post-hook 'systemctl start nginx'"
```
-  `certbot-renew.service`中手动添加

```bash
[Unit]
Description=Certbot
Documentation=file:///usr/share/doc/python-certbot-doc/html/index.html
Documentation=https://certbot.eff.org/docs
[Service]
Type=oneshot
ExecStart=certbot renew --pre-hook "systemctl stop nginx" --post-hook "systemctl restart nginx"
PrivateTmp=true
```

- 使用`certbot renew`自带的`Hook`目录（自行搜索）

然后重新加载`systemd`并生效：
```bash
systemctl daemon-reload
systemctl start certbot.service
```

>*或者使用python3-certbot-nginx插件，见 [https://www.f5.com/company/blog/nginx/using-free-ssltls-certificates-from-lets-encrypt-with-nginx](https://www.f5.com/company/blog/nginx/using-free-ssltls-certificates-from-lets-encrypt-with-nginx)*。

2. `crontab`建立周期任务

certbot 默认配置：

```bash
# /etc/cron.d/certbot: crontab entries for the certbot package
#
# Upstream recommends attempting renewal twice a day
#
# Eventually, this will be an opportunity to validate certificates
# haven't been revoked, etc.  Renewal will only occur if expiration
# is within 30 days.
#
# Important Note!  This cronjob will NOT be executed if you are
# running systemd as your init system.  If you are running systemd,
# the cronjob.timer function takes precedence over this cronjob.  For
# more details, see the systemd.timer manpage, or use systemctl show
# certbot.timer.
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin

0 */12 * * * root test -x /usr/bin/certbot -a \! -d /run/systemd/system && perl -e 'sleep int(rand(43200))' && certbot -q renew
```
**如果系统运行了systemd，这里crontab不会执行！**

手动添加crontab任务：
```bash
crontab -e
0 0  1 */3 * sudo systemctl stop nginx && certbot -q renew --renew-hook "systemctl restart nginx" //每隔3个月的当月第一天0分0秒执行一次
```
前5位表示分(0-60)、时(0-24)、天(1-30)、月(1-12)、周(0-6)。
`- q`表示不输出执行结果日志。

**补充：**
```bash
crontab -l //查看当前用户周期任务
crontab -l -u root //查看root用户周期任务
cat /etc/passwd | cut -f 1 -d : | xargs -I {} crontab -l -u {} //以root用户执行，查看所有周期任务
```

- `/var/spool/cron/crontabs/` 路径下有所有用户的任务。
- `/etc/crontab` 负责调度各种管理和维护任务。
- `/etc/cron.d/` 存放着要执行的crontab任务。

### 二、其他问题

**为什么部署完成还是用不了？**

- cloudflare 的 SSL/TLS 等级要改为 Full。
- ...

### 三、参考链接

- [Xray 官方文档](https://xtls.github.io/)
- [Certbot 官方教程](https://certbot.eff.org/)
- [Let's Encrypt 与 Nginx](https://www.f5.com/company/blog/nginx/using-free-ssltls-certificates-from-lets-encrypt-with-nginx)
