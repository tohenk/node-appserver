@echo off
title ntReport Server

%~d0
cd %~dp0

setlocal

if [%1]==[-c] (
	set CFG=%2
	shift
	shift
)

if [%1]==[] (
	set NODE_ENV=production
) else (
	set NODE_ENV=%1
)

if [%CFG%] == [] (
	node app.js
) else (
	node app.js --config=%CFG%
)

endlocal