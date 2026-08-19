#!/bin/bash

# Exit on first error for setup actions
# set -e is omitted so we can handle manual error handling in subcommands

# Define text colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Determine brew service name for postgresql
get_pg_service() {
    if brew services list | grep -q "postgresql@15"; then
        echo "postgresql@15"
    else
        echo "postgresql"
    fi
}

start_services() {
    echo -e "${YELLOW}Starting local services...${NC}"
    
    # 1. Start PostgreSQL
    if pg_isready >/dev/null 2>&1; then
        echo -e "${GREEN}PostgreSQL is already running.${NC}"
    else
        PG_SVC=$(get_pg_service)
        echo -e "${YELLOW}Starting PostgreSQL ($PG_SVC) via Homebrew...${NC}"
        brew services start "$PG_SVC" >/dev/null 2>&1
        sleep 2
        if pg_isready >/dev/null 2>&1; then
            echo -e "${GREEN}PostgreSQL started successfully.${NC}"
        else
            echo -e "${RED}Failed to start PostgreSQL. Check your brew installation.${NC}"
            return 1
        fi
    fi

    # 2. Setup node modules if missing
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}node_modules not found. Running npm install...${NC}"
        npm install
    fi

    # 3. Setup Database schema
    echo -e "${YELLOW}Syncing database schema...${NC}"
    npx prisma generate
    npx prisma db push

    # 4. Start Dev Server
    echo -e "${GREEN}Launching Next.js development server...${NC}"
    npm run dev
}

stop_services() {
    echo -e "${YELLOW}Stopping local services...${NC}"

    # 1. Stop Next.js Dev Server
    echo -e "${YELLOW}Stopping Next.js dev server...${NC}"
    # Find next dev processes and terminate them
    PID=$(pgrep -f "next-dev" || pgrep -f "next dev" || true)
    if [ ! -z "$PID" ]; then
        echo -e "${YELLOW}Stopping process ids: $PID${NC}"
        kill -9 $PID >/dev/null 2>&1 || true
    fi
    # Also release port 3000 if bound
    P3000=$(lsof -t -i:3000 || true)
    if [ ! -z "$P3000" ]; then
        kill -9 $P3000 >/dev/null 2>&1 || true
    fi
    echo -e "${GREEN}Next.js server stopped.${NC}"

    # 2. Stop PostgreSQL
    PG_SVC=$(get_pg_service)
    echo -e "${YELLOW}Stopping PostgreSQL ($PG_SVC) via Homebrew...${NC}"
    brew services stop "$PG_SVC" >/dev/null 2>&1 || true
    echo -e "${GREEN}PostgreSQL stopped.${NC}"
}

print_status() {
    echo -e "${YELLOW}Checking Yuyu service status...${NC}"
    
    # Check Postgres
    if pg_isready >/dev/null 2>&1; then
        echo -e "${GREEN}● PostgreSQL: RUNNING and accepting connections${NC}"
    else
        echo -e "${RED}○ PostgreSQL: STOPPED${NC}"
    fi

    # Check Dev Server
    PID=$(pgrep -f "next-dev" || pgrep -f "next dev" || true)
    PORT_ACTIVE=$(lsof -i:3000 -t || true)
    
    if [ ! -z "$PID" ] || [ ! -z "$PORT_ACTIVE" ]; then
        echo -e "${GREEN}● Dev Server: RUNNING (Port 3000)${NC}"
        if [ ! -z "$PID" ]; then
            echo -e "   Process IDs: $PID"
        fi
    else
        echo -e "${RED}○ Dev Server: STOPPED${NC}"
    fi
}

# Subcommand Router
COMMAND=${1:-"start"}

case "$COMMAND" in
    start)
        start_services
        ;;
    stop)
        stop_services
        ;;
    status)
        print_status
        ;;
    restart)
        stop_services
        echo -e "${YELLOW}Waiting a moment...${NC}"
        sleep 2
        start_services
        ;;
    *)
        echo -e "${RED}Unknown command: $COMMAND${NC}"
        echo "Usage: ./local.sh {start|stop|restart|status}"
        exit 1
        ;;
esac
