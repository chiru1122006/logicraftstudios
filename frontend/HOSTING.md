# Logicraft Studio — Azure Production Hosting Guide

Comprehensive guide to deploying and hosting **Logicraft Studio** on Microsoft Azure to ensure ultra-fast compilation, smooth multi-user concurrency, and 100% functional board emulation (including **Raspberry Pi 3 Linux**, **ESP32**, **ESP32-C3 RISC-V**, and **Arduino**).

---

## 1. Architecture Overview

Logicraft Studio combines client-side WebAssembly with backend emulation services:

| Board Family | Emulation Engine | Where It Runs | Backend Requirements |
| :--- | :--- | :--- | :--- |
| **Arduino (Uno, Nano, Mega)** | `avr8js` (Cycle-accurate) | **Browser (Client)** | None (zero backend CPU for simulation; optional compile via `arduino-cli`) |
| **Raspberry Pi Pico (RP2040)** | `rp2040js` | **Browser (Client)** | None |
| **Analog / SPICE Circuits** | `ngspice-WASM` | **Browser (Client)** | None |
| **ESP32 / ESP32-S3** | `libqemu-xtensa` (Xtensa LX6/LX7) | **Azure Backend** | Backend WebSocket + QEMU shared library + ESP-IDF 5.x compiler |
| **ESP32-C3 / CH32V003** | `libqemu-riscv32` (RISC-V) | **Azure Backend** | Backend WebSocket + RISC-V QEMU library + compiler |
| **Raspberry Pi 3B** | `qemu-system-aarch64` | **Azure Backend** | Backend WebSocket + full QEMU system process + Raspberry Pi OS disk image |

---

## 2. Azure Server / VM Selection Guide

Because **Raspberry Pi 3** boots real Linux inside QEMU and **ESP32** builds use multi-threaded C++ compilation (`ninja` + `ccache`), your server requires strong single-thread performance, multiple vCPUs, and sufficient RAM.

### Recommended Azure VM Tiers

| Tier | Azure VM Size | vCPUs | RAM | Expected Concurrency | Best For | Estimated Cost |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Production Scale (Recommended)** | **`Standard_D8s_v5`** | **8 vCPUs** | **32 GiB** | **30 – 80 active users** | Smooth compilation (~10s warm), multiple concurrent Pi Linux sessions | ~$270 / month |
| **High Scale / Classroom / University** | **`Standard_D16s_v5`** | **16 vCPUs** | **64 GiB** | **80 – 200 active users** | Heavy concurrent classroom loads, instant ESP-IDF builds | ~$540 / month |
| **Starter / Cost-Effective** | **`Standard_D4s_v5`** | **4 vCPUs** | **16 GiB** | **10 – 30 active users** | Low-cost entry tier for testing and small groups | ~$135 / month |

### Crucial VM Specifications:
1. **CPU Series**: Choose **Dsv5-series** (Intel Xeon Platinum 8370C / 3rd Gen Intel Ice Lake) or **Dasv5-series** (AMD EPYC 7763). Both offer high clock speeds and hyper-threading.
2. **Disk**: **Premium SSD (P15 or P20: 256GB - 512GB)**. Fast disk I/O is critical for QEMU `qcow2` overlay copy-on-write disks and `ccache` compilation caching.
3. **Operating System**: **Ubuntu 22.04 LTS (x86_64 / amd64)**.
4. **Region**: Choose the region closest to your primary user base (e.g. **Central India - Pune**, **South India - Chennai**, or **East US**) for low WebSocket latency (<50ms).

---

## 3. Azure Networking & Security Group (NSG)

In the Azure Portal, configure your Network Security Group inbound port rules:

| Priority | Name | Port | Protocol | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **100** | `SSH` | `22` | TCP | Secure shell access |
| **110** | `HTTP` | `80` | TCP | Web traffic & Let's Encrypt verification |
| **120** | `HTTPS` | `443` | TCP | Encrypted web & secure WebSockets (`wss://`) |

---

## 4. Provisioning the Azure Server (Step-by-Step)

### Step 4.1: Connect via SSH
```bash
ssh -i /path/to/your-key.pem azureuser@<YOUR_AZURE_PUBLIC_IP>
```

### Step 4.2: Update System & Install Docker Engine
```bash
# Update package repositories
sudo apt-get update && sudo apt-get upgrade -y

# Install prerequisites
sudo apt-get install -y ca-certificates curl gnupg lsb-release git htop ufw

# Add Docker's official GPG key and repository
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker & Docker Compose plugin
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Allow current user to run Docker without sudo
sudo usermod -aG docker $USER
newgrp docker
```

### Step 4.3: Configure Host Performance & Swap
Raspberry Pi 3 QEMU instances and compiler spikes benefit from a fast swap file to prevent out-of-memory errors:

```bash
# Allocate 8GB Swap
sudo fallocate -l 8G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Optimize swappiness
sudo sysctl vm.swappiness=10
echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf
```

---

## 5. Deploying the Backend & Full Simulator

### Step 5.1: Clone the Repository on Azure
```bash
git clone https://github.com/chiru1122006/logicraftstudios.git /home/azureuser/logicraftstudios
cd /home/azureuser/logicraftstudios
```

### Step 5.2: Ensure QEMU & Raspberry Pi Boot Images are Ready

#### 1. Raspberry Pi 3 OS Image:
The Raspberry Pi 3 engine uses `qemu-system-aarch64` with a minimal Linux kernel and Debian Trixie filesystem.
Create the boot image cache directory:
```bash
sudo mkdir -p /var/cache/velxio/boot-images/raspberry-pi-3
```
Ensure the following files are present in `/var/cache/velxio/boot-images/raspberry-pi-3`:
- `kernel8.img` (ARM64 Linux kernel)
- `bcm2710-rpi-3-b.dtb` (Device Tree Blob)
- `raspios-trixie-armhf.img` (Root filesystem)

#### 2. ESP32 QEMU Libraries:
Ensure `prebuilt/qemu/` contains:
- `libqemu-xtensa.so`
- `libqemu-riscv32.so`
- `esp32-v3-rom.bin`
- `esp32c3-rom.bin`
- `esp32s3_rev0_rom.bin`

### Step 5.3: Start Logicraft Studio with Docker Compose
```bash
cd /home/azureuser/logicraftstudios
docker compose up -d --build
```

Check running containers:
```bash
docker compose ps
docker compose logs -f
```

---

## 6. Nginx & Domain SSL Setup (api.logicraftstudios.tech)

To enable secure `https://` access and `wss://` secure WebSockets from the browser, configure an Nginx reverse proxy on the host.

### Step 6.1: Install Nginx and Certbot
```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

### Step 6.2: Configure Nginx Reverse Proxy
Create `/etc/nginx/sites-available/logicraftstudios.conf`:

```nginx
server {
    server_name api.logicraftstudios.tech 104.214.172.50;

    # Maximum sketch and firmware upload size
    client_max_body_size 64M;

    # Standard API endpoints
    location / {
        proxy_pass http://127.0.0.1:3080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Simulation WebSockets (Raspberry Pi 3, ESP32 serial, Pin events)
    location /api/simulation/ws/ {
        proxy_pass http://127.0.0.1:3080/api/simulation/ws/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        
        # Keep simulation alive without timeouts
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

Enable the configuration:
```bash
sudo ln -s /etc/nginx/sites-available/logicraftstudios.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Step 6.3: Obtain Free SSL Certificate via Let's Encrypt
```bash
sudo certbot --nginx -d api.logicraftstudios.tech
```

---

## 7. Connecting Frontend (Vercel) to Azure Backend

If your frontend is deployed on Vercel at `https://logicraftstudios.tech`, your `vercel.json` automatically routes API and simulation traffic:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "vite",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://api.logicraftstudios.tech/api/:path*"
    },
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

---

## 8. Verification & Health Checks

Once deployed, verify everything from your local terminal:

```bash
# 1. Check API Health
curl -i https://api.logicraftstudios.tech/health

# 2. Check Board Support
curl -s https://api.logicraftstudios.tech/api/boards | jq .

# 3. Monitor VM Load During Simulation
htop
```

---

## 9. Maintenance & Troubleshooting

### Viewing Backend Simulation Logs
```bash
docker logs -f velxio-dev
```

### Clearing ESP-IDF Compiler Cache if Corrupted
```bash
docker exec -it velxio-dev ccache -C
```

### Restarting the Simulator Stack
```bash
docker compose restart
```
