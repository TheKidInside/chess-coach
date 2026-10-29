@echo off
rem Chess Coach: starts the local server (Stockfish + coach AI bridge) with no console
rem window (pyw); the server opens the app in its own window once it is ready, and
rem stops itself about 10 minutes after the last app window closes. Log: server.log
cd /d "%~dp0"
start "" pyw server.py
