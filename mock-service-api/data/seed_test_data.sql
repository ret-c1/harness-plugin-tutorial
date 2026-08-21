PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

INSERT OR IGNORE INTO assets (
    asset_code, name, asset_type, ip_address, hostname, mac_address,
    operating_system, vendor, model, location, department, owner_id,
    criticality, exposure, security_zone, status, description, tags,
    created_at, updated_at
) VALUES
    ('ASSET-001', '生产 Web 服务器', 'server', '203.0.113.10', 'prod-web-01', '02:00:00:00:01:01',
     'Ubuntu Server 24.04 LTS', 'Dell', 'PowerEdge R650', '上海数据中心 A3', '平台研发部',
     (SELECT id FROM users WHERE username = 'user_a'), 'critical', 'internet', 'DMZ', 'active',
     '承载公司门户及公网业务入口。', '["production","web","internet"]',
     '2026-08-01T01:00:00+00:00', '2026-08-20T01:00:00+00:00'),
    ('ASSET-002', '订单 API 服务器', 'server', '10.20.10.11', 'order-api-01', '02:00:00:00:02:01',
     'Rocky Linux 9.5', 'HPE', 'ProLiant DL360 Gen11', '上海数据中心 B1', '交易研发部',
     (SELECT id FROM users WHERE username = 'user_a'), 'high', 'intranet', '应用区', 'active',
     '处理订单创建、查询及状态回调。', '["production","api","order"]',
     '2026-08-01T01:05:00+00:00', '2026-08-19T06:30:00+00:00'),
    ('ASSET-003', '核心交易数据库', 'database', '10.20.20.21', 'trade-db-01', '02:00:00:00:03:01',
     'PostgreSQL 16 / Rocky Linux 9', 'Dell', 'PowerEdge R760', '上海数据中心 C2', '数据库团队',
     (SELECT id FROM users WHERE username = 'admin'), 'critical', 'isolated', '数据区', 'active',
     '保存交易核心数据，仅允许应用区白名单访问。', '["production","database","pci"]',
     '2026-08-01T01:10:00+00:00', '2026-08-18T03:20:00+00:00'),
    ('ASSET-004', '互联网边界防火墙', 'network_device', '203.0.113.1', 'edge-fw-01', '02:00:00:00:04:01',
     'FortiOS 7.4', 'Fortinet', 'FortiGate 1800F', '上海数据中心出口区', '网络运维部',
     (SELECT id FROM users WHERE username = 'admin'), 'critical', 'internet', '边界区', 'active',
     '互联网出口访问控制及 VPN 汇聚设备。', '["network","firewall","internet"]',
     '2026-08-01T01:15:00+00:00', '2026-08-17T08:10:00+00:00'),
    ('ASSET-005', 'Kubernetes 生产集群', 'container', '10.20.30.15', 'k8s-prod-control', NULL,
     'Kubernetes 1.32 / Containerd', 'CNCF', 'Production Cluster', '上海数据中心容器区', '云平台部',
     (SELECT id FROM users WHERE username = 'user_a'), 'high', 'intranet', '容器区', 'active',
     '运行订单、会员和消息服务的生产容器集群。', '["production","kubernetes","container"]',
     '2026-08-01T01:20:00+00:00', '2026-08-16T02:40:00+00:00'),
    ('ASSET-006', '客户关系管理系统', 'application', '10.20.10.60', 'crm.internal.example', NULL,
     'Java 21 / Spring Boot', 'Internal', 'CRM 4.2', '私有云应用区', '销售运营部',
     (SELECT id FROM users WHERE username = 'user_a'), 'high', 'intranet', '应用区', 'active',
     '内部 CRM 应用，包含客户联系人与跟进记录。', '["application","crm","internal"]',
     '2026-08-01T01:25:00+00:00', '2026-08-15T05:00:00+00:00'),
    ('ASSET-007', '审计日志对象存储', 'cloud', NULL, 'audit-log-bucket', NULL,
     'S3 Compatible Object Storage', 'Alibaba Cloud', 'OSS', '华东 2 区域', '安全运营部',
     (SELECT id FROM users WHERE username = 'admin'), 'medium', 'intranet', '云资源区', 'active',
     '集中保存应用、主机与安全设备审计日志。', '["cloud","storage","audit-log"]',
     '2026-08-01T01:30:00+00:00', '2026-08-14T07:45:00+00:00'),
    ('ASSET-008', '财务人员终端', 'endpoint', '10.20.40.88', 'fin-pc-088', '02:00:00:00:08:01',
     'Windows 11 Enterprise 24H2', 'Lenovo', 'ThinkCentre M90q', '上海总部 8F', '财务部',
     (SELECT id FROM users WHERE username = 'user_b'), 'high', 'intranet', '办公终端区', 'active',
     '用于网银复核和财务报表处理的专用终端。', '["endpoint","finance","windows"]',
     '2026-08-01T01:35:00+00:00', '2026-08-13T09:15:00+00:00'),
    ('ASSET-009', '异地备份服务器', 'server', '10.30.50.12', 'backup-dr-01', '02:00:00:00:09:01',
     'Debian 12', 'Inspur', 'NF5180M6', '苏州灾备中心', '基础设施部',
     NULL, 'medium', 'isolated', '备份区', 'offline',
     '每日接收核心系统离线备份，当前处于维护窗口。', '["backup","dr","offline"]',
     '2026-08-01T01:40:00+00:00', '2026-08-12T04:30:00+00:00'),
    ('ASSET-010', '遗留报表服务器', 'other', '10.20.60.30', 'legacy-report-01', '02:00:00:00:10:01',
     'CentOS 7.9', 'IBM', 'System x3650 M4', '上海数据中心旧设备区', '数据分析部',
     NULL, 'low', 'intranet', '遗留系统区', 'retired',
     '已完成业务迁移，保留用于历史报表核验。', '["legacy","report","retired"]',
     '2026-08-01T01:45:00+00:00', '2026-08-11T08:00:00+00:00');

INSERT OR IGNORE INTO vulnerabilities (
    vuln_code, name, cve_id, cnnvd_id, severity, cvss_score, vuln_type,
    source, description, solution, discovered_at, due_at, status,
    assignee_id, closed_at, created_at, updated_at
) VALUES
    ('VULN-001', 'Apache HTTP Server 路径穿越与命令执行漏洞', 'CVE-2021-41773', 'CNNVD-202110-097',
     'critical', 9.8, 'remote_code_execution', '漏洞扫描平台',
     '目标 Web 服务版本存在路径穿越风险，特定配置下可导致远程命令执行。',
     '升级 Apache HTTP Server 至安全版本并检查 CGI 配置。',
     '2026-08-10T02:10:00+00:00', '2026-08-21T10:00:00+00:00', 'responding',
     (SELECT id FROM users WHERE username = 'user_a'), NULL,
     '2026-08-10T02:10:00+00:00', '2026-08-20T03:00:00+00:00'),
    ('VULN-002', 'Log4j 远程代码执行漏洞', 'CVE-2021-44228', 'CNNVD-202112-799',
     'critical', 10.0, 'remote_code_execution', 'SCA 组件扫描',
     '订单服务依赖中检测到受影响的 Log4j 组件。',
     '升级 Log4j 至安全版本，清理旧依赖并重新发布应用。',
     '2026-08-11T01:20:00+00:00', '2026-08-20T10:00:00+00:00', 'no_response',
     (SELECT id FROM users WHERE username = 'user_a'), NULL,
     '2026-08-11T01:20:00+00:00', '2026-08-19T08:25:00+00:00'),
    ('VULN-003', 'PostgreSQL 弱口令配置', NULL, NULL,
     'high', 8.1, 'weak_password', '基线核查',
     '数据库巡检发现测试账户口令复杂度不符合安全基线。',
     '禁用无用账户，重置弱口令并启用口令复杂度策略。',
     '2026-08-12T03:00:00+00:00', '2026-08-23T10:00:00+00:00', 'responding',
     (SELECT id FROM users WHERE username = 'admin'), NULL,
     '2026-08-12T03:00:00+00:00', '2026-08-20T02:15:00+00:00'),
    ('VULN-004', 'FortiOS 管理接口认证绕过漏洞', 'CVE-2022-40684', 'CNNVD-202210-1118',
     'critical', 9.6, 'authentication_bypass', '设备漏洞扫描',
     '边界防火墙管理接口版本处于受影响范围。',
     '升级 FortiOS，限制管理面来源并核查异常管理员操作。',
     '2026-08-12T06:40:00+00:00', '2026-08-21T10:00:00+00:00', 'closed',
     (SELECT id FROM users WHERE username = 'admin'), '2026-08-18T07:30:00+00:00',
     '2026-08-12T06:40:00+00:00', '2026-08-18T07:30:00+00:00'),
    ('VULN-005', 'Ingress-NGINX Admission Controller 远程代码执行漏洞', 'CVE-2025-1974', NULL,
     'critical', 9.8, 'remote_code_execution', '容器安全平台',
     '集群 Ingress Controller 的准入控制器可能被未授权网络访问。',
     '升级 Ingress-NGINX，限制 Admission Controller 网络访问。',
     '2026-08-13T01:55:00+00:00', '2026-08-22T10:00:00+00:00', 'responding',
     (SELECT id FROM users WHERE username = 'user_a'), NULL,
     '2026-08-13T01:55:00+00:00', '2026-08-19T11:10:00+00:00'),
    ('VULN-006', 'Spring Framework 远程代码执行漏洞', 'CVE-2022-22965', 'CNNVD-202204-009',
     'high', 9.8, 'remote_code_execution', '应用漏洞扫描',
     'CRM 应用使用的 Spring Framework 版本处于受影响范围。',
     '升级 Spring Framework 与 Spring Boot，并完成回归测试。',
     '2026-08-14T05:10:00+00:00', '2026-08-25T10:00:00+00:00', 'no_response',
     (SELECT id FROM users WHERE username = 'user_a'), NULL,
     '2026-08-14T05:10:00+00:00', '2026-08-20T01:35:00+00:00'),
    ('VULN-007', '对象存储桶访问策略过宽', NULL, NULL,
     'medium', 6.5, 'security_misconfiguration', '云安全中心',
     '审计日志存储桶策略允许非预期账号读取对象列表。',
     '收敛 Bucket Policy，启用最小权限并轮换相关访问密钥。',
     '2026-08-15T02:25:00+00:00', '2026-08-28T10:00:00+00:00', 'responding',
     (SELECT id FROM users WHERE username = 'admin'), NULL,
     '2026-08-15T02:25:00+00:00', '2026-08-20T00:50:00+00:00'),
    ('VULN-008', 'Windows Print Spooler 远程代码执行漏洞', 'CVE-2021-34527', 'CNNVD-202107-150',
     'high', 8.8, 'privilege_escalation', '终端管理平台',
     '财务终端缺少打印后台处理程序安全更新。',
     '安装安全补丁；非打印终端禁用 Print Spooler 服务。',
     '2026-08-15T08:00:00+00:00', '2026-08-24T10:00:00+00:00', 'closed',
     (SELECT id FROM users WHERE username = 'user_b'), '2026-08-19T04:20:00+00:00',
     '2026-08-15T08:00:00+00:00', '2026-08-19T04:20:00+00:00'),
    ('VULN-009', 'OpenSSH 用户名枚举漏洞', 'CVE-2018-15473', 'CNNVD-201808-648',
     'medium', 5.3, 'information_disclosure', '漏洞扫描平台',
     '备份服务器 OpenSSH 版本可被用于枚举有效用户名。',
     '升级 OpenSSH，限制管理网访问并启用多因素认证。',
     '2026-08-16T07:35:00+00:00', '2026-08-30T10:00:00+00:00', 'no_response',
     NULL, NULL,
     '2026-08-16T07:35:00+00:00', '2026-08-20T02:05:00+00:00'),
    ('VULN-010', '遗留服务仍启用 TLS 1.0', NULL, NULL,
     'low', 3.7, 'weak_cryptography', '配置合规扫描',
     '遗留报表服务仍接受 TLS 1.0 连接。',
     '关闭 TLS 1.0/1.1，仅启用组织批准的加密套件。',
     '2026-08-17T04:45:00+00:00', '2026-09-05T10:00:00+00:00', 'closed',
     NULL, '2026-08-19T09:00:00+00:00',
     '2026-08-17T04:45:00+00:00', '2026-08-19T09:00:00+00:00');

INSERT OR IGNORE INTO vulnerability_assets (vulnerability_id, asset_id)
SELECT v.id, a.id FROM vulnerabilities v JOIN assets a
WHERE (v.vuln_code = 'VULN-001' AND a.asset_code IN ('ASSET-001', 'ASSET-002'))
   OR (v.vuln_code = 'VULN-002' AND a.asset_code IN ('ASSET-002', 'ASSET-006'))
   OR (v.vuln_code = 'VULN-003' AND a.asset_code = 'ASSET-003')
   OR (v.vuln_code = 'VULN-004' AND a.asset_code = 'ASSET-004')
   OR (v.vuln_code = 'VULN-005' AND a.asset_code = 'ASSET-005')
   OR (v.vuln_code = 'VULN-006' AND a.asset_code = 'ASSET-006')
   OR (v.vuln_code = 'VULN-007' AND a.asset_code = 'ASSET-007')
   OR (v.vuln_code = 'VULN-008' AND a.asset_code = 'ASSET-008')
   OR (v.vuln_code = 'VULN-009' AND a.asset_code = 'ASSET-009')
   OR (v.vuln_code = 'VULN-010' AND a.asset_code = 'ASSET-010');

INSERT OR IGNORE INTO security_events (
    event_code, title, category, severity, source, source_ip,
    destination_ip, description, occurred_at, detected_at, status,
    assignee_id, response_summary, closed_at, created_at, updated_at
) VALUES
    ('EVENT-001', '公网 SSH 暴力破解', 'authentication_attack', 'high', 'SIEM',
     '198.51.100.23', '203.0.113.10', '5 分钟内检测到 860 次 SSH 登录失败，来源地址已加入观察列表。',
     '2026-08-20T00:12:00+00:00', '2026-08-20T00:13:00+00:00', 'no_response',
     (SELECT id FROM users WHERE username = 'user_a'), NULL, NULL,
     '2026-08-20T00:13:00+00:00', '2026-08-20T00:13:00+00:00'),
    ('EVENT-002', 'WAF 拦截 SQL 注入攻击', 'web_attack', 'critical', 'WAF',
     '198.51.100.45', '203.0.113.10', '攻击者针对登录和客户查询接口提交多组 SQL 注入载荷。',
     '2026-08-19T15:30:00+00:00', '2026-08-19T15:30:30+00:00', 'responding',
     (SELECT id FROM users WHERE username = 'user_a'), '已封禁来源 IP，正在核查应用及数据库访问日志。', NULL,
     '2026-08-19T15:30:30+00:00', '2026-08-20T02:40:00+00:00'),
    ('EVENT-003', '数据库账户异常批量导出', 'data_exfiltration', 'critical', '数据库审计',
     '10.20.10.77', '10.20.20.21', '服务账户在非业务时段执行大批量客户数据查询与导出。',
     '2026-08-19T14:05:00+00:00', '2026-08-19T14:06:00+00:00', 'responding',
     (SELECT id FROM users WHERE username = 'admin'), '已冻结服务账户并保全数据库审计记录。', NULL,
     '2026-08-19T14:06:00+00:00', '2026-08-20T03:10:00+00:00'),
    ('EVENT-004', '财务终端检测到木马程序', 'malware', 'high', 'EDR',
     '10.20.40.88', '10.20.40.88', 'EDR 检测到恶意脚本下载并尝试建立持久化任务。',
     '2026-08-18T06:42:00+00:00', '2026-08-18T06:42:20+00:00', 'closed',
     (SELECT id FROM users WHERE username = 'user_b'), '终端已隔离并完成重装，恶意样本及相关域名已加入封禁策略。',
     '2026-08-19T03:20:00+00:00', '2026-08-18T06:42:20+00:00', '2026-08-19T03:20:00+00:00'),
    ('EVENT-005', '边界设备发现横向端口扫描', 'network_scan', 'medium', 'NDR',
     '198.51.100.88', '203.0.113.1', '外部地址对多个高风险服务端口进行连续探测。',
     '2026-08-18T02:15:00+00:00', '2026-08-18T02:16:00+00:00', 'closed',
     (SELECT id FROM users WHERE username = 'admin'), '确认未发生入侵，来源网段已临时封禁。',
     '2026-08-18T08:30:00+00:00', '2026-08-18T02:16:00+00:00', '2026-08-18T08:30:00+00:00'),
    ('EVENT-006', '生产集群创建高权限容器', 'container_anomaly', 'high', '容器安全平台',
     '10.20.30.66', '10.20.30.15', '检测到未知流水线账户创建 privileged 容器并挂载宿主机目录。',
     '2026-08-17T10:20:00+00:00', '2026-08-17T10:20:15+00:00', 'responding',
     (SELECT id FROM users WHERE username = 'user_a'), '已删除异常 Pod 并暂停相关流水线凭据。', NULL,
     '2026-08-17T10:20:15+00:00', '2026-08-20T01:25:00+00:00'),
    ('EVENT-007', '云访问密钥疑似泄露', 'credential_leak', 'critical', '云安全中心',
     '198.51.100.117', NULL, '对象存储访问密钥从未授权地区调用 ListObjects 接口。',
     '2026-08-17T03:05:00+00:00', '2026-08-17T03:06:00+00:00', 'no_response',
     (SELECT id FROM users WHERE username = 'admin'), NULL, NULL,
     '2026-08-17T03:06:00+00:00', '2026-08-20T02:55:00+00:00'),
    ('EVENT-008', '备份服务器出现勒索软件行为', 'ransomware', 'critical', '主机入侵检测',
     '10.30.50.44', '10.30.50.12', '离线备份服务器维护期间出现批量文件改名及高频加密调用。',
     '2026-08-16T12:35:00+00:00', '2026-08-16T12:36:00+00:00', 'no_response',
     NULL, NULL, NULL,
     '2026-08-16T12:36:00+00:00', '2026-08-20T00:35:00+00:00'),
    ('EVENT-009', '遗留系统发生 TLS 降级连接', 'protocol_anomaly', 'low', '流量审计',
     '10.20.40.25', '10.20.60.30', '客户端与遗留报表服务协商使用 TLS 1.0。',
     '2026-08-15T09:18:00+00:00', '2026-08-15T09:19:00+00:00', 'closed',
     NULL, '确认是历史核验任务，已停用旧协议并更新客户端配置。',
     '2026-08-16T02:00:00+00:00', '2026-08-15T09:19:00+00:00', '2026-08-16T02:00:00+00:00'),
    ('EVENT-010', '管理员账号异地登录告警', 'account_anomaly', 'info', '身份认证平台',
     '198.51.100.201', '10.20.10.11', '管理员账号在短时间内从两个地理位置完成登录。',
     '2026-08-14T23:50:00+00:00', '2026-08-14T23:50:10+00:00', 'closed',
     (SELECT id FROM users WHERE username = 'admin'), '经本人确认系授权 VPN 切换，未发现账号失陷。',
     '2026-08-15T01:10:00+00:00', '2026-08-14T23:50:10+00:00', '2026-08-15T01:10:00+00:00');

INSERT OR IGNORE INTO event_assets (event_id, asset_id)
SELECT e.id, a.id FROM security_events e JOIN assets a
WHERE (e.event_code = 'EVENT-001' AND a.asset_code IN ('ASSET-001', 'ASSET-004'))
   OR (e.event_code = 'EVENT-002' AND a.asset_code IN ('ASSET-001', 'ASSET-006'))
   OR (e.event_code = 'EVENT-003' AND a.asset_code = 'ASSET-003')
   OR (e.event_code = 'EVENT-004' AND a.asset_code = 'ASSET-008')
   OR (e.event_code = 'EVENT-005' AND a.asset_code = 'ASSET-004')
   OR (e.event_code = 'EVENT-006' AND a.asset_code = 'ASSET-005')
   OR (e.event_code = 'EVENT-007' AND a.asset_code = 'ASSET-007')
   OR (e.event_code = 'EVENT-008' AND a.asset_code = 'ASSET-009')
   OR (e.event_code = 'EVENT-009' AND a.asset_code = 'ASSET-010')
   OR (e.event_code = 'EVENT-010' AND a.asset_code IN ('ASSET-002', 'ASSET-006'));

COMMIT;
