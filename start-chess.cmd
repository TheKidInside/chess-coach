@echo off
rem Chess Coach: starts the local server (Stockfish + coach AI bridge) with no console
rem window (pyw); the server opens the app in its own window once it is ready, and
rem stops itself about 10 minutes after the last app window closes. Log: server.log
rem Also starts the local Qwen server (coach AI) minimised, unless something already listens on :8080.
netstat -ano | findstr /r /c:":8080 .*LISTENING" >nul || start "Qwen (local LLM)" /min "C:\Artificial\tools\llm\start-qwen.cmd"
cd /d "%~dp0"
start "" pyw server.py
