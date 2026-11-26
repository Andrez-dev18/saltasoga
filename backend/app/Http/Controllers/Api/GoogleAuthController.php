<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\GoogleTokenVerifier;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use RuntimeException;

class GoogleAuthController extends Controller
{
    public function __construct(private readonly GoogleTokenVerifier $verifier) {}

    /**
     * Autentica con un ID token de Google Identity Services y emite un token Sanctum.
     */
    public function handle(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'credential' => 'required|string',
        ]);

        try {
            $payload = $this->verifier->verify($validated['credential']);
        } catch (RuntimeException) {
            return response()->json([
                'status' => 'error',
                'message' => 'El inicio de sesión con Google no está configurado.',
            ], 503);
        }

        if (! $payload) {
            return response()->json([
                'status' => 'error',
                'message' => 'No se pudo verificar la cuenta de Google.',
            ], 401);
        }

        $googleId = (string) ($payload['sub'] ?? '');
        $email = strtolower(trim((string) ($payload['email'] ?? '')));
        $emailVerified = filter_var($payload['email_verified'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $name = trim((string) ($payload['name'] ?? ''));
        $avatar = (string) ($payload['picture'] ?? '');

        if ($googleId === '' || $email === '' || ! $emailVerified) {
            return response()->json([
                'status' => 'error',
                'message' => 'La cuenta de Google no tiene un correo verificado.',
            ], 422);
        }

        try {
            $user = DB::transaction(function () use ($googleId, $email, $name, $avatar) {
                $user = User::query()->where('google_id', $googleId)->first();

                if (! $user) {
                    $user = User::query()->where('email', $email)->first();

                    if ($user && $user->google_id && $user->google_id !== $googleId) {
                        return null;
                    }
                }

                if ($user) {
                    $user->google_id = $googleId;

                    if (! $user->avatar && $avatar !== '') {
                        $user->avatar = $avatar;
                    }

                    if (! $user->name && $name !== '') {
                        $user->name = $name;
                    }

                    $user->save();

                    return $user;
                }

                return User::create([
                    'name' => $name !== '' ? $name : $email,
                    'email' => $email,
                    'google_id' => $googleId,
                    'avatar' => $avatar !== '' ? $avatar : null,
                    'password' => null,
                ]);
            });
        } catch (UniqueConstraintViolationException) {
            return response()->json([
                'status' => 'error',
                'message' => 'No se pudo vincular la cuenta de Google. Intenta nuevamente.',
            ], 409);
        }

        if (! $user) {
            return response()->json([
                'status' => 'error',
                'message' => 'Este correo ya está vinculado a otra cuenta de Google.',
            ], 409);
        }

        $token = $user->createToken('pwa')->plainTextToken;

        return response()->json([
            'status' => 'success',
            'message' => 'Inicio de sesión con Google exitoso',
            'user' => $user,
            'token' => $token,
        ], 200);
    }
}
