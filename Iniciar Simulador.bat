@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
title Simulador BPMN 2.0
pushd "%~dp0"

echo.
echo  ============================================================
echo    SIMULADOR BPMN 2.0 - inicializacao
echo  ============================================================
echo.

REM ------------------------------------------------------------------
REM 1) Localiza o Node.js
REM ------------------------------------------------------------------
set "NODE_EXE="

where node >nul 2>&1
if %errorlevel%==0 (
  set "NODE_EXE=node"
) else (
  if exist "%ProgramFiles%\nodejs\node.exe"      set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
  if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
  if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
  if exist "%APPDATA%\nvm\current\node.exe"      set "NODE_EXE=%APPDATA%\nvm\current\node.exe"
)

if not defined NODE_EXE (
  echo  [ERRO] Node.js nao foi encontrado neste computador.
  echo.
  echo  O simulador precisa do Node.js ^(versao 16 ou superior^).
  echo  Baixe a versao LTS em:  https://nodejs.org/pt-br/download
  echo  Depois de instalar, feche esta janela e execute este .bat novamente.
  echo.
  pause
  popd
  exit /b 1
)

for /f "tokens=*" %%v in ('"%NODE_EXE%" --version 2^>nul') do set "NODE_VER=%%v"
echo  [OK] Node.js encontrado: %NODE_VER%

REM ------------------------------------------------------------------
REM 2) Resolve dependencias declaradas em package.json
REM    (o projeto foi escrito sem dependencias externas de proposito,
REM     mas se alguma for adicionada no futuro, ela sera instalada aqui)
REM ------------------------------------------------------------------
if not exist "package.json" (
  echo  [ERRO] package.json nao encontrado em "%CD%".
  echo         Execute este arquivo .bat de dentro da pasta do projeto.
  pause
  popd
  exit /b 1
)

"%NODE_EXE%" -e "var p=require('./package.json');var n=Object.keys(p.dependencies||{}).length+Object.keys(p.devDependencies||{}).length;process.exit(n>0?0:1);" >nul 2>&1
if %errorlevel%==0 (
  echo  [..] Dependencias declaradas encontradas. Verificando instalacao...
  if exist "node_modules" (
    echo  [OK] Pasta node_modules ja existe. Rodando verificacao rapida...
  )
  where npm >nul 2>&1
  if !errorlevel!==0 (
    call npm install --no-audit --no-fund
    if !errorlevel! neq 0 (
      echo  [AVISO] npm install retornou erro. O servidor sera iniciado assim mesmo,
      echo          pois o nucleo do simulador nao depende de pacotes externos.
    ) else (
      echo  [OK] Dependencias resolvidas.
    )
  ) else (
    echo  [AVISO] npm nao encontrado no PATH. Pulando a instalacao.
  )
) else (
  echo  [OK] Nenhuma dependencia externa a instalar ^(projeto autocontido^).
)

REM ------------------------------------------------------------------
REM 3) Garante a pasta de diagramas
REM ------------------------------------------------------------------
if not exist "diagramas" mkdir "diagramas"
if exist "pizzaria-delivery-as-is.bpmn" (
  if not exist "diagramas\pizzaria-delivery-as-is.bpmn" (
    copy /y "pizzaria-delivery-as-is.bpmn" "diagramas\" >nul
    echo  [OK] Diagrama de exemplo copiado para \diagramas.
  )
)

REM ------------------------------------------------------------------
REM 4) Sobe o servidor (ele abre o navegador sozinho)
REM ------------------------------------------------------------------
echo.
echo  [..] Iniciando o servidor local...
echo       O navegador sera aberto automaticamente.
echo       Para encerrar o simulador, feche esta janela ou pressione CTRL+C.
echo.

"%NODE_EXE%" server.js --port 4000

echo.
echo  Servidor encerrado.
popd
endlocal
pause
