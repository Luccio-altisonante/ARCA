#ifndef ANAGRAMMI_SHA256_HPP
#define ANAGRAMMI_SHA256_HPP

#include <array>
#include <cstddef>
#include <cstdint>
#include <string>

namespace anagrammi {
namespace dettaglio {

using DigestSha256 = std::array<std::uint8_t, 32>;

DigestSha256 sha256(const std::uint8_t* dati, std::size_t dimensione);
std::string sha256_esadecimale(const DigestSha256& digest);

} // namespace dettaglio
} // namespace anagrammi

#endif
