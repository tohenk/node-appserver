@echo off
title ntReport Server

%~d0
cd %~dp0

if [%1]==[-c] (
	set NT_REPORT_CONFIG=%2
	shift
	shift
)

if [%1]==[] (
	set NODE_ENV=production
) else (
	set NODE_ENV=%1
)

node app.js