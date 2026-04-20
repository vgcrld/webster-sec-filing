# Production deploy (AWS EC2 + Caddy)

This directory contains everything needed to run the Webster SEC Filing chat on a
single Ubuntu 24.04 EC2 instance behind Caddy (auto HTTPS via Let's Encrypt).

Architecture:

- `t3.small` EC2 (Ubuntu 24.04) with an Elastic IP.
- Caddy on :80/:443 reverse-proxying to Node on `127.0.0.1:3001` with SSE-safe
  settings (no buffering, no proxy timeouts).
- `server/index.js` runs as user `webster` under systemd, reading env from
  `/etc/webster-sec.env` which is populated from SSM Parameter Store on boot.
- `XAI_API_KEY` is stored only in SSM Parameter Store (SecureString) and in
  `/etc/webster-sec.env` (root:root, mode 600). It is never in the repo.

## Files

- `Caddyfile` — vhost with `flush_interval -1` so SSE streams through.
- `webster-sec.service` — systemd unit (runs `node server/index.js`).
- `bootstrap.sh` — one-time fresh-instance setup.
- `refresh-env.sh` — rewrites `/etc/webster-sec.env` from SSM (installed as
  `/usr/local/sbin/webster-sec-refresh-env`).
- `../scripts/deploy.sh` — manual deploy from laptop.

## One-time AWS setup

Replace `chat.example.com` and the region to match your environment.

1. **Store the xAI API key in SSM:**

   ```bash
   aws ssm put-parameter \
     --name /webster-sec/xai_api_key \
     --type SecureString \
     --value 'xai-...' \
     --region us-east-1
   ```

2. **Create an IAM role for the instance** (name it `webster-sec-ec2`) with this
   inline policy, and an `ec2.amazonaws.com` trust policy:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["ssm:GetParameter"],
         "Resource": "arn:aws:ssm:us-east-1:<ACCOUNT_ID>:parameter/webster-sec/xai_api_key"
       },
       {
         "Effect": "Allow",
         "Action": ["kms:Decrypt"],
         "Resource": "arn:aws:kms:us-east-1:<ACCOUNT_ID>:alias/aws/ssm"
       }
     ]
   }
   ```

3. **Launch the instance:**
   - AMI: Ubuntu Server 24.04 LTS
   - Type: `t3.small` (2 vCPU, 2 GB RAM)
   - Storage: 20 GB gp3
   - IAM instance profile: `webster-sec-ec2`
   - Security group: inbound 22/tcp from your IP, 80/tcp and 443/tcp from `0.0.0.0/0`
   - Key pair: your SSH key

4. **Allocate and attach an Elastic IP** to the instance.

5. **Point DNS:** create an `A` record for `chat.example.com` -> the Elastic IP.
   Wait for it to resolve before running Caddy or you'll burn Let's Encrypt
   rate limits.

## Initial server provisioning

From your laptop, copy this `deploy/` folder to the instance and run
`bootstrap.sh`:

```bash
# Ship the deploy scripts to /tmp/deploy on the instance
rsync -az deploy/ ubuntu@<EIP>:/tmp/deploy/

# Run bootstrap
ssh ubuntu@<EIP> 'sudo DOMAIN=chat.example.com bash /tmp/deploy/bootstrap.sh'
```

What this does:

- Installs Node.js 20, Caddy, AWS CLI v2.
- Creates user `webster` and `/srv/webster-sec-filing`.
- Installs the systemd unit and Caddyfile (with `DOMAIN` baked in).
- Pulls `XAI_API_KEY` from SSM into `/etc/webster-sec.env` (mode 600).
- Starts Caddy. `webster-sec` is enabled but will only start once the app is
  deployed in the next step.

## Deploy the app

From the repo root on your laptop:

```bash
HOST=<EIP-or-dns> ./scripts/deploy.sh
```

This will:

1. `rsync` the repo (minus `node_modules`, `.git`, `client/dist`, `.env`) to
   `/srv/webster-sec-filing`.
2. Run `npm run install:all && npm run build` on the instance.
3. `sudo systemctl restart webster-sec`.

Visit `https://chat.example.com`. Caddy fetches a Let's Encrypt cert on the
first request; `/api/health` should return `{"ok":true,...}`.

## Operations

Tail logs:

```bash
ssh ubuntu@<EIP> 'sudo journalctl -u webster-sec -f'
ssh ubuntu@<EIP> 'sudo journalctl -u caddy -f'
```

Rotate the xAI key (update SSM first, then refresh on the box):

```bash
aws ssm put-parameter --name /webster-sec/xai_api_key \
  --type SecureString --overwrite --value 'xai-...'
ssh ubuntu@<EIP> 'sudo /usr/local/sbin/webster-sec-refresh-env'
```

Change the model:

```bash
ssh ubuntu@<EIP> 'sudo sed -i "s/^XAI_MODEL=.*/XAI_MODEL=grok-4-1-fast-reasoning/" /etc/webster-sec.env && sudo systemctl restart webster-sec'
```

## Trade-offs

- Single instance: no autoscaling, no multi-AZ. If the box dies you're down
  until you re-launch.
- The 14 MB PDF is parsed at each process start (~1-3 s); `Restart=on-failure`
  covers crashes.
- Natural upgrade path when you need HA: build a Docker image of the Node
  server, push to ECR, run on ECS Fargate behind an ALB (ALB supports SSE with
  default idle timeout bumped to 4000 s).
