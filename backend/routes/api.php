<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\GoogleAuthController;
use App\Http\Controllers\Api\JumpSessionController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

// Rutas públicas de autenticación
Route::post('/register', [AuthController::class, 'register']);
Route::post('/login', [AuthController::class, 'login']);
Route::post('/auth/google', [GoogleAuthController::class, 'handle'])->middleware('throttle:10,1');

// Rutas protegidas con Laravel Sanctum (Bearer Token)
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/user', function (Request $request) {
        return response()->json([
            'status' => 'success',
            'user' => $request->user(),
        ]);
    });

    Route::post('/logout', [AuthController::class, 'logout']);
    Route::get('/stats', [JumpSessionController::class, 'stats']);
    Route::apiResource('sessions', JumpSessionController::class)->only(['index', 'store', 'show', 'destroy']);
});
