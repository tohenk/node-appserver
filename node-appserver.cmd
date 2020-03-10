@echo off
title Node.js App Server

%~d0
cd %~dp0

setlocal

if [%1]==[-c] (
	set CFG=%2
	shift
	shift
)

if [%CFG%] == [] (
	node app.js
) else (
	node app.js --config=%CFG%
)

endlocal