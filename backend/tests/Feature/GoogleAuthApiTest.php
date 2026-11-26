<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\GoogleTokenVerifier;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

class GoogleAuthApiTest extends TestCase
{
    use RefreshDatabase;

    private function fakeGooglePayload(?array $payload): void
    {
        $this->app->instance(GoogleTokenVerifier::class, new class($payload) implements GoogleTokenVerifier
        {
            public function __construct(private readonly ?array $payload) {}

            public function verify(string $idToken): ?array
            {
                return $this->payload;
            }
        });
    }

    private function validPayload(array $overrides = []): array
    {
        return array_merge([
            'sub' => 'google-sub-123',
            'email' => 'google@example.com',
            'email_verified' => true,
            'name' => 'Google User',
            'picture' => 'https://example.com/avatar.png',
        ], $overrides);
    }

    public function test_google_login_creates_user_and_returns_token(): void
    {
        $this->fakeGooglePayload($this->validPayload());

        $response = $this->postJson('/api/auth/google', [
            'credential' => 'fake-id-token',
        ]);

        $response->assertOk()
            ->assertJsonStructure([
                'status',
                'message',
                'user' => ['id', 'name', 'email', 'google_id', 'avatar'],
                'token',
            ])
            ->assertJsonPath('user.email', 'google@example.com')
            ->assertJsonPath('user.google_id', 'google-sub-123');

        $user = User::where('email', 'google@example.com')->firstOrFail();

        $this->assertNull($user->password);
        $this->assertSame('google-sub-123', $user->google_id);

        $this->withToken($response->json('token'))
            ->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('user.email', 'google@example.com');
    }

    public function test_google_login_links_existing_user_by_verified_email(): void
    {
        $user = User::factory()->create([
            'name' => 'Cuenta Local',
            'email' => 'google@example.com',
            'password' => 'secret1234',
        ]);

        $this->fakeGooglePayload($this->validPayload());

        $this->postJson('/api/auth/google', [
            'credential' => 'fake-id-token',
        ])->assertOk();

        $user->refresh();

        $this->assertSame('google-sub-123', $user->google_id);
        $this->assertSame('Cuenta Local', $user->name);
        $this->assertDatabaseCount('users', 1);

        $this->postJson('/api/login', [
            'email' => 'google@example.com',
            'password' => 'secret1234',
        ])->assertOk()->assertJsonStructure(['token', 'user']);
    }

    public function test_google_login_rejects_unverified_email(): void
    {
        $this->fakeGooglePayload($this->validPayload(['email_verified' => false]));

        $this->postJson('/api/auth/google', [
            'credential' => 'fake-id-token',
        ])->assertStatus(422);

        $this->assertDatabaseMissing('users', [
            'email' => 'google@example.com',
        ]);
    }

    public function test_google_login_rejects_invalid_token(): void
    {
        $this->fakeGooglePayload(null);

        $this->postJson('/api/auth/google', [
            'credential' => 'invalid-token',
        ])->assertStatus(401);

        $this->assertDatabaseCount('users', 0);
    }

    public function test_google_login_requires_credential(): void
    {
        $this->postJson('/api/auth/google', [])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['credential']);
    }

    public function test_google_login_returns_503_when_not_configured(): void
    {
        $this->app->instance(GoogleTokenVerifier::class, new class implements GoogleTokenVerifier
        {
            public function verify(string $idToken): ?array
            {
                throw new RuntimeException('GOOGLE_CLIENT_ID no está configurado.');
            }
        });

        $this->postJson('/api/auth/google', [
            'credential' => 'fake-id-token',
        ])->assertStatus(503);
    }
}
