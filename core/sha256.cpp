#include "sha256.hpp"

#include <algorithm>
#include <limits>
#include <stdexcept>

namespace anagrammi {
namespace dettaglio {
namespace {

constexpr std::array<std::uint32_t, 64> costanti = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2};

std::uint32_t ruota(std::uint32_t valore, unsigned passi) {
    return (valore >> passi) | (valore << (32 - passi));
}

void comprimi(std::array<std::uint32_t, 8>& stato, const std::uint8_t* blocco) {
    std::array<std::uint32_t, 64> parole{};
    for (std::size_t i = 0; i < 16; ++i) {
        for (std::size_t j = 0; j < 4; ++j) {
            parole[i] = (parole[i] << 8) | blocco[4 * i + j];
        }
    }
    for (std::size_t i = 16; i < parole.size(); ++i) {
        const auto x = parole[i - 15];
        const auto y = parole[i - 2];
        const auto s0 = ruota(x, 7) ^ ruota(x, 18) ^ (x >> 3);
        const auto s1 = ruota(y, 17) ^ ruota(y, 19) ^ (y >> 10);
        parole[i] = parole[i - 16] + s0 + parole[i - 7] + s1;
    }
    auto a = stato[0], b = stato[1], c = stato[2], d = stato[3];
    auto e = stato[4], f = stato[5], g = stato[6], h = stato[7];
    for (std::size_t i = 0; i < parole.size(); ++i) {
        const auto s1 = ruota(e, 6) ^ ruota(e, 11) ^ ruota(e, 25);
        const auto scelta = (e & f) ^ (~e & g);
        const auto t1 = h + s1 + scelta + costanti[i] + parole[i];
        const auto s0 = ruota(a, 2) ^ ruota(a, 13) ^ ruota(a, 22);
        const auto maggioranza = (a & b) ^ (a & c) ^ (b & c);
        const auto t2 = s0 + maggioranza;
        h = g; g = f; f = e; e = d + t1;
        d = c; c = b; b = a; a = t1 + t2;
    }
    stato[0] += a; stato[1] += b; stato[2] += c; stato[3] += d;
    stato[4] += e; stato[5] += f; stato[6] += g; stato[7] += h;
}

} // namespace

DigestSha256 sha256(const std::uint8_t* dati, std::size_t dimensione) {
    if ((dati == nullptr && dimensione != 0) ||
        dimensione > std::numeric_limits<std::uint64_t>::max() / 8) {
        throw std::invalid_argument("Buffer SHA-256 non valido o troppo grande");
    }
    std::array<std::uint32_t, 8> stato = {
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};
    std::size_t posizione = 0;
    while (dimensione - posizione >= 64) {
        comprimi(stato, dati + posizione);
        posizione += 64;
    }
    std::array<std::uint8_t, 128> finale{};
    const auto restanti = dimensione - posizione;
    if (restanti != 0) {
        std::copy_n(dati + posizione, restanti, finale.begin());
    }
    finale[restanti] = 0x80;
    const std::size_t lunghezza_finale = restanti < 56 ? 64 : 128;
    const auto bit = static_cast<std::uint64_t>(dimensione) * 8;
    for (std::size_t i = 0; i < 8; ++i) {
        finale[lunghezza_finale - 1 - i] = static_cast<std::uint8_t>(bit >> (8 * i));
    }
    comprimi(stato, finale.data());
    if (lunghezza_finale == 128) {
        comprimi(stato, finale.data() + 64);
    }
    DigestSha256 digest{};
    for (std::size_t i = 0; i < stato.size(); ++i) {
        for (std::size_t j = 0; j < 4; ++j) {
            digest[4 * i + j] = static_cast<std::uint8_t>(stato[i] >> (24 - 8 * j));
        }
    }
    return digest;
}

std::string sha256_esadecimale(const DigestSha256& digest) {
    constexpr char cifre[] = "0123456789abcdef";
    std::string testo;
    testo.reserve(64);
    for (auto byte : digest) {
        testo.push_back(cifre[byte >> 4]);
        testo.push_back(cifre[byte & 15]);
    }
    return testo;
}

} // namespace dettaglio
} // namespace anagrammi
