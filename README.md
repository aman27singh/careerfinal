# 🚀 CareerCoach: Agentic AI-Powered Career Co-Pilot

**CareerCoach** is a fully deployed, agentic AI system that autonomously analyzes your skills, tracks mastery, generates personalized learning quests, and recommends high-impact actions based on real market data. The agentic intelligence loop continuously updates your roadmap, mastery tracker, and questing system — ensuring you always receive the most relevant, personalized guidance.

🌐 **Live App**: [https://ddlbxm6g4ypkb.cloudfront.net](https://ddlbxm6g4ypkb.cloudfront.net)  
⚡ **API**: `https://6cnjdgd0yi.execute-api.us-east-1.amazonaws.com`

---

## ✨ Key Features

### 🤖 Agentic Intelligence Hub
A fully autonomous intelligence engine that continuously analyzes your profile, market trends, and skill gaps. The agentic loop proactively recommends next actions, updates mastery, and surfaces new quests — no manual refresh needed.

### 🔍 AI Profile Scanning
Connect your professional identity (Resume + GitHub) to extract a deep-learning backed representation of your technical skill proficiency. Skills learned through quests are automatically merged back into your profile analysis, keeping your skill picture always up to date.

### 📊 Role-Gap Analysis
Compare your current skill set against real-time market demands. The agentic engine identifies high-priority gaps and suggests specific areas for improvement tailored to your target role.

### 🗺️ Dynamic Roadmap & Auto-Advancing Quest Map
CareerCoach generates a personalized roadmap with actionable "Agentic Quests." When you complete a roadmap, the system automatically re-analyzes your updated skill set and generates the **next roadmap** — fully hands-free agentic progression.

### 🐸 Agentic Daily Quests
Tackle your most challenging task first with the **Agentic Daily Quest** system. Submit your work and receive AI-powered grading and XP rewards, ensuring continuous progress.

### 📈 Mastery Tracker & Knowledge Map
Your skill mastery is visualized through a live **Knowledge Map** (radar chart) and **Activity Curve** (30-day XP history). Skill mastery levels update automatically as you complete quests and learn new skills.

### 🏆 Rank & XP Progression
Earn XP to climb through ranked tiers — **Bronze → Silver → Gold → Platinum → Diamond** — each with a distinctive rank badge displayed across your Dashboard and Stats page.

### 💬 Skill Ratings & Quest Skills
Your **Skill Ratings** card shows a tiered breakdown of all skills — including a dedicated **"Learned via Quests"** tier for skills acquired by completing in-platform quests.

### 🏰 Tiered Discord Communities
Unlock access to specialized professional guilds as you gain XP:
- **Beginner Community** — 500 XP
- **Intermediate Community** — 1,000 XP
- **Advanced Community** — 2,500 XP
- **Expert Community** — 5,000 XP

---

## 🛠️ Tech Stack

### Frontend
- **Framework**: React.js + Vite
- **Styling**: Vanilla CSS (Glassmorphism design system)
- **Visualization**: Recharts (radar, bar, line charts)
- **Icons**: Lucide-React
- **Hosting**: AWS S3 + CloudFront CDN

### Backend
- **Framework**: FastAPI (Python 3.12)
- **Runtime**: AWS Lambda (serverless, `manylinux2014_x86_64` build)
- **API**: AWS API Gateway (REST)
- **AI/LLM**: Amazon Bedrock (Claude)
- **Database**: Amazon DynamoDB (user state, XP, activity logs)
- **Market Data**: Custom curated `market_skills.json` dataset

---

## 🚀 Getting Started (Local Development)

### Prerequisites
- Python 3.9+
- Node.js & npm
- AWS credentials configured (`aws configure`)

### 1. Backend Setup

```bash
# Create and activate virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start the FastAPI server
uvicorn app.main:app --reload
```

The API will be available at `http://localhost:8000`.

### 2. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

To point the frontend at your local backend, update `BASE_URL` in `frontend/src/App.jsx` to `http://localhost:8000`.

---

## ☁️ AWS Deployment

### Backend — AWS Lambda

The backend is packaged as a Linux-compatible zip and deployed to AWS Lambda:

```bash
source .venv/bin/activate
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
ZIP_NAME="careeros_lambda_${TIMESTAMP}.zip"

rm -rf .lambda_build && mkdir .lambda_build
pip install -r requirements.txt -t .lambda_build/ \
  --platform manylinux2014_x86_64 --python-version 3.12 --only-binary :all: -q
cp -r app .lambda_build/
cd .lambda_build && zip -r ../${ZIP_NAME} . -q && cd ..

aws s3 cp ${ZIP_NAME} s3://careeros-resumes-985090322407/deployments/${ZIP_NAME} --region us-east-1
aws lambda update-function-code \
  --function-name careeros-api \
  --region us-east-1 \
  --s3-bucket careeros-resumes-985090322407 \
  --s3-key deployments/${ZIP_NAME}
```

Or use the convenience script: `bash deploy/deploy_backend.sh`

### Frontend — S3 + CloudFront

```bash
cd frontend && npm run build
aws s3 sync dist/ s3://careeros-frontend-985090322407/ --delete --region us-east-1
DIST_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?DomainName=='ddlbxm6g4ypkb.cloudfront.net'].Id" \
  --output text --region us-east-1)
aws cloudfront create-invalidation --distribution-id $DIST_ID --paths "/*" --region us-east-1
```

### AWS Resources

| Resource | Name / ID |
|---|---|
| Lambda function | `careeros-api` |
| API Gateway | `6cnjdgd0yi` (us-east-1) |
| S3 — Lambda zips | `careeros-resumes-985090322407` |
| S3 — Frontend | `careeros-frontend-985090322407` |
| CloudFront | `ddlbxm6g4ypkb.cloudfront.net` |
| DynamoDB table | `careeros-users` |

### IAM Permissions Required

> `bedrock:InvokeModel`, `dynamodb:GetItem`, `dynamodb:PutItem`, `dynamodb:UpdateItem`, `dynamodb:Query`, `s3:GetObject`, `s3:PutObject`

---

## 📂 Project Structure

```text
├── app/                      # FastAPI backend
│   ├── main.py               # API routes and Lambda handler
│   ├── models.py             # Pydantic data schemas
│   ├── data/                 # Market skills dataset + user JSON store
│   └── services/             # AI engines
│       ├── eval_engine.py    # Quest grading & XP feedback
│       ├── game_engine.py    # XP, leveling, rank logic
│       ├── profile_engine.py # Resume/GitHub skill extraction
│       ├── roadmap_engine.py # Roadmap & quest generation
│       ├── role_engine.py    # Role-gap analysis
│       └── skill_curation.py # Market skill queries
├── frontend/                 # React + Vite frontend
│   └── src/
│       ├── App.jsx           # Main app (all components)
│       └── App.css           # Glassmorphism design system
├── scripts/                  # Data processing utilities
├── deploy/                   # Deployment scripts
└── requirements.txt          # Python dependencies
```

---

## 👤 User Customization

User state is persisted in **DynamoDB** (`careeros-users` table). For local development and testing, fallback JSON profiles are available at `app/data/users/user_1.json`. Adjust XP, levels, and skill weights there for local testing without touching the live database.

---

**Built with ❤️ for the next generation of top-tier developers.**
