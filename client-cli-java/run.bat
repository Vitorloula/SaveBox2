@echo off
title SaveBox 2.0 - Java CLI Client
echo ===================================================
echo   Compilando SaveBox 2.0 CLI Client (Sem dependencias)
echo ===================================================
if not exist bin mkdir bin

javac -d bin src/SaveBoxClient.java
if %errorlevel% neq 0 (
    echo [ERRO] Falha ao compilar o Java Client. Verifique se o JDK 11 ou superior esta instalado e no PATH.
    pause
    exit /b %errorlevel%
)

echo.
echo ===================================================
echo   Iniciando SaveBox 2.0 CLI Client...
echo ===================================================
java -cp bin client.SaveBoxClient
pause
