# Shubhanshu Aggarwal: portfolio website

An animated portfolio built with **HTML, CSS, JavaScript, Flask and MySQL**, ready to deploy on **AWS EC2**.
Visitors can send you a message from the contact form. It is saved in MySQL.

```
portfolio/
├── app.py              Flask app: pages, contact API, optional inbox
├── content.py          ALL the text on the site. Edit this to change anything.
├── schema.sql          MySQL table (the app also creates it by itself)
├── templates/          index.html, 404.html, admin_messages.html
├── static/             css, js, fonts, favicon (fonts are self-hosted)
├── deploy/             systemd service + nginx config for EC2
├── requirements.txt
└── .env.example        copy to .env and fill in
```

## 1. Run it on your computer

You need Python 3.10 or newer.

```bash
cd portfolio
python -m venv venv

# Windows:
venv\Scripts\activate
# macOS / Linux:
source venv/bin/activate

pip install -r requirements.txt
python.exe -m pip install --upgrade pip
python app.py
```

Open http://127.0.0.1:5000. With no `DATABASE_URL` set, contact messages are saved in a local
SQLite file (`instance/portfolio.db`), so everything works before you set up MySQL.

## 2. Change the content

Open `content.py`. Your name, links, skills, education, certifications and experience are all there
as plain lists. Save the file and refresh the page.

### Adding your projects later

The Projects section is hidden until you add a project. In `content.py`, fill the `PROJECTS` list:

```python
PROJECTS = [
    {
        "title": "Smart Complaint Management Platform",
        "status": "In progress",                      # or "Completed", or "" to hide
        "stack": ["Flask", "MySQL"],
        "points": [
            "What the project does.",
            "What you built in it.",
        ],
        "links": [{"label": "GitHub", "url": "https://github.com/your-name/your-repo"}],  # optional
    },
]
```

The "Projects" link in the menu appears by itself.

### Adding a resume download button

Put a PDF at `static/resume.pdf` and a "Download resume" button appears in the hero.
**Use a version without your date of birth and home address**, because anyone who visits the site can download it.

## 3. MySQL

Install MySQL 8 (or use AWS RDS, see below), then:

```bash
# Creates the database and the table
sudo mysql < schema.sql

# Create a user for the app (change the password)
sudo mysql -e "CREATE USER 'portfolio'@'localhost' IDENTIFIED BY 'change-this-password';
               GRANT SELECT, INSERT ON portfolio.* TO 'portfolio'@'localhost';"
```

Copy `.env.example` to `.env` and set:

```
DATABASE_URL=mysql+pymysql://portfolio:change-this-password@localhost:3306/portfolio?charset=utf8mb4
```

If your password has special characters (`@`, `#`, `/`, `:`), URL-encode them, for example `@` becomes `%40`.

### Reading your messages

Either query the table:

```sql
SELECT name, email, message, created_at FROM contact_messages ORDER BY created_at DESC;
```

or turn on the built-in inbox by setting `ADMIN_USER` and `ADMIN_PASSWORD` in `.env`.
It then lives at `/admin/messages` behind a login. Leave them empty to keep it off.

### Spam protection built in

A hidden field that bots fill in, a limit of 3 messages per visitor every 10 minutes, input checks on the
server, and plain-text storage (messages are escaped when shown).

## 4. Deploy on AWS (EC2, with optional RDS)

This is the simple, low-cost setup: one EC2 server running nginx, gunicorn and the Flask app.

### a) Launch the server

1. In the AWS console, open **EC2, Launch instance**.
2. Choose **Ubuntu Server 24.04 LTS** and an instance type marked free-tier eligible (check current terms on the pricing page).
3. Create or pick a key pair. Keep the `.pem` file safe.
4. Security group inbound rules: **SSH (22)** from *My IP* only, **HTTP (80)** and **HTTPS (443)** from anywhere.
5. After launch, allocate an **Elastic IP** and associate it with the instance, so the address does not change when you restart.

### b) Set up the server

```bash
ssh -i your-key.pem ubuntu@YOUR_ELASTIC_IP

sudo apt update
sudo apt install -y python3-venv python3-pip nginx unzip
# Only if MySQL runs on this same server:
sudo apt install -y mysql-server
# Only if you use RDS instead:
sudo apt install -y mysql-client
```

From your computer, upload the project and unzip it on the server:

```bash
scp -i your-key.pem portfolio.zip ubuntu@YOUR_ELASTIC_IP:~
# then, on the server:
unzip portfolio.zip && cd portfolio
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
```

### c) Database

**Option A: MySQL on the same server.** Follow section 3 above.

**Option B: AWS RDS (managed MySQL).**
1. RDS, Create database, **MySQL**, same VPC as the EC2 instance, **Public access: No**.
2. Give the RDS security group an inbound rule: **MySQL/Aurora (3306)** with source = the EC2 instance's security group.
3. From the EC2 server, run the schema once with the RDS master user:
   `mysql -h YOUR-DB.xxxx.rds.amazonaws.com -u admin -p < schema.sql`
4. Create the app user the same way as in section 3 (run those two statements over the same connection, with `'%'` instead of `'localhost'`).
5. Use the RDS endpoint in `DATABASE_URL`.

### d) Configure and start the app

```bash
cp .env.example .env
nano .env          # set DATABASE_URL, set BEHIND_PROXY=1, optionally ADMIN_USER / ADMIN_PASSWORD
chmod 600 .env     # only you can read it

sudo cp deploy/portfolio.service /etc/systemd/system/portfolio.service
sudo systemctl daemon-reload
sudo systemctl enable --now portfolio

curl http://127.0.0.1:8000/healthz        # should print {"status":"ok"}
```

Then nginx:

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/portfolio
sudo nano /etc/nginx/sites-available/portfolio   # put your domain in server_name (or use "_")
sudo ln -s /etc/nginx/sites-available/portfolio /etc/nginx/sites-enabled/portfolio
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Visit `http://YOUR_ELASTIC_IP`. The site should load.

### e) Your own domain and HTTPS

1. Point an **A record** for your domain (and `www`) to the Elastic IP. Route 53 or any registrar works.
2. On the server:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d example.com -d www.example.com
```

Certbot installs the certificate and renews it automatically.

### f) Updating the site later

```bash
# upload the new files, then:
sudo systemctl restart portfolio
```

If something looks wrong: `sudo journalctl -u portfolio -n 50` shows the app's log, and `sudo nginx -t` checks the nginx config.

On Amazon Linux instead of Ubuntu, use `dnf` instead of `apt`, and the user is `ec2-user`
(change it in `deploy/portfolio.service` too).

## Notes

- If MySQL is down, the pages still load. Only the contact form shows an error that tells the visitor to email you.
- The site has no external requests: fonts are included, so it works fast and does not send visitor data to third parties.
- Animations stop automatically for visitors who turn on "reduce motion" in their system settings.
- Light and dark themes follow the visitor's system setting. The sun/moon button overrides it and is remembered.
