

proxy_claude() {
    set -a && source "$HOME/Library/Application Support/com.proxyman.NSProxy/app-data/proxyman_env_automatic_setup.sh" &>/dev/null  && set +a;
    claude mcp add context7 -s project -- npx -y @upstash/context7-mcp;
    claude; 
}
proxy_claude

