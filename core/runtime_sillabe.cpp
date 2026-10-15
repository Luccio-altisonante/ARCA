#include "runtime_sillabe.hpp"

#include "sha256.hpp"

#include <algorithm>
#include <array>
#include <limits>
#include <stdexcept>
#include <utility>

namespace anagrammi {
namespace {

constexpr std::size_t header_size = 192;

void richiedi(bool condizione, const char* messaggio) {
    if (!condizione) {
        throw std::invalid_argument(messaggio);
    }
}

std::uint64_t somma(std::uint64_t a, std::uint64_t b) {
    richiedi(b <= std::numeric_limits<std::uint64_t>::max() - a, "Overflow somma layout");
    return a + b;
}

std::uint64_t prodotto(std::uint64_t a, std::uint64_t b) {
    richiedi(a == 0 || b <= std::numeric_limits<std::uint64_t>::max() / a, "Overflow prodotto layout");
    return a * b;
}

std::size_t come_size(std::uint64_t valore) {
    richiedi(valore <= std::numeric_limits<std::size_t>::max(), "Layout non rappresentabile in size_t");
    return static_cast<std::size_t>(valore);
}

std::uint64_t leggi_le(const std::vector<std::uint8_t>& bytes, std::size_t posizione, std::size_t quanti) {
    richiedi(posizione <= bytes.size() && quanti <= bytes.size() - posizione, "Intero troncato");
    std::uint64_t valore = 0;
    for (std::size_t i = 0; i < quanti; ++i) {
        valore |= static_cast<std::uint64_t>(bytes[posizione + i]) << (8 * i);
    }
    return valore;
}

std::string hash_header(const std::vector<std::uint8_t>& bytes, std::size_t posizione) {
    dettaglio::DigestSha256 digest{};
    std::copy_n(bytes.begin() + posizione, digest.size(), digest.begin());
    return dettaglio::sha256_esadecimale(digest);
}

void verifica_hash(const std::string& effettivo, const std::optional<std::string>& atteso) {
    if (!atteso) {
        return;
    }
    richiedi(atteso->size() == 64 && std::all_of(atteso->begin(), atteso->end(), [](char c) {
        return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
    }), "SHA-256 atteso non valido");
    richiedi(effettivo == *atteso, "SHA-256 atteso incompatibile");
}

unsigned popcount_byte(std::uint8_t bits) {
    unsigned totale = 0;
    while (bits != 0) {
        bits = static_cast<std::uint8_t>(bits & (bits - 1));
        ++totale;
    }
    return totale;
}

void valida_metadata(const std::vector<std::uint8_t>& bytes, std::size_t posizione,
                     std::uint32_t cardinalita) {
    const auto stato = bytes[posizione + 4];
    const auto origine = bytes[posizione + 5];
    richiedi(stato >= 1 && stato <= 7 && origine >= 1 && origine <= 2, "Stato/origine illegale");
    richiedi(bytes[posizione + 6] == 0 && bytes[posizione + 7] == 0, "Metadata riservato non zero");
    richiedi(stato <= 3 ? cardinalita == 1 : stato == 6 ? cardinalita >= 2 : cardinalita == 0,
             "Cardinalita incompatibile con lo stato");
    richiedi(origine != 2 || stato == 1 || stato == 5 || stato == 6 || stato == 7,
             "Stato incompatibile con la curatela ufficiale");
}

} // namespace

FiltroSillabe::FiltroSillabe(std::uint64_t minimo, std::uint64_t massimo) {
    const auto limite = std::numeric_limits<std::uint32_t>::max();
    richiedi(minimo >= 1 && minimo <= limite && massimo >= 1 && massimo <= limite,
             "Numero sillabe non uint32 positivo");
    richiedi(minimo <= massimo, "Intervallo sillabe invertito");
    minimo_ = static_cast<std::uint32_t>(minimo);
    massimo_ = static_cast<std::uint32_t>(massimo);
}

FiltroSillabe FiltroSillabe::esattamente(std::uint64_t numero) {
    return FiltroSillabe(numero, numero);
}

FiltroSillabe FiltroSillabe::almeno(std::uint64_t numero) {
    return FiltroSillabe(numero, std::numeric_limits<std::uint32_t>::max());
}

FiltroSillabe FiltroSillabe::al_massimo(std::uint64_t numero) {
    return FiltroSillabe(1, numero);
}

FiltroSillabe FiltroSillabe::tra(std::uint64_t minimo, std::uint64_t massimo) {
    return FiltroSillabe(minimo, massimo);
}

RuntimeSillabe::RuntimeSillabe(std::vector<std::uint8_t> bytes, const VerificheRuntimeSillabe& verifiche)
    : bytes_(std::move(bytes)) {
    richiedi(bytes_.size() >= header_size, "Header troncato");
    constexpr std::array<std::uint8_t, 8> magic = {'S', 'I', 'L', 'L', 'B', 'M', 0, 0};
    richiedi(std::equal(magic.begin(), magic.end(), bytes_.begin()), "Magic errato");
    richiedi(leggi_le(bytes_, 8, 2) == 1, "Versione runtime non supportata");
    richiedi(leggi_le(bytes_, 10, 2) == header_size && leggi_le(bytes_, 12, 4) == 0,
             "Dimensione header/flags illegali");
    richiedi(std::all_of(bytes_.begin() + 160, bytes_.begin() + header_size,
                        [](std::uint8_t b) { return b == 0; }), "Header riservato non zero");

    const auto n = leggi_le(bytes_, 16, 4);
    const auto k = leggi_le(bytes_, 20, 4);
    const auto m = leggi_le(bytes_, 24, 4);
    const auto stride = somma(n, 7) / 8;
    const auto directory_at = somma(header_size, prodotto(8, n));
    const auto bitmap_at = somma(directory_at, prodotto(16, k));
    const auto lunghezza = somma(bitmap_at, prodotto(k, stride));
    richiedi(leggi_le(bytes_, 28, 4) == stride && leggi_le(bytes_, 32, 8) == header_size &&
             leggi_le(bytes_, 40, 8) == directory_at && leggi_le(bytes_, 48, 8) == bitmap_at,
             "Offset/stride non canonici");
    // Nessuna conversione o allocazione da dimensioni ostili prima di questi controlli.
    const auto dimensione = come_size(lunghezza);
    richiedi(leggi_le(bytes_, 56, 8) == lunghezza && bytes_.size() == dimensione,
             "Lunghezza incoerente, file troncato o byte extra");
    richiedi(k <= m && m <= prodotto(n, k), "N/K/M incoerenti");
    numero_grafie_ = static_cast<std::uint32_t>(n);
    numero_membership_ = static_cast<std::uint32_t>(m);
    stride_ = come_size(stride);
    vocabolario_sha256_ = hash_header(bytes_, 64);
    annotazioni_sha256_ = hash_header(bytes_, 96);
    verifica_hash(vocabolario_sha256_, verifiche.vocabolario_sha256);
    verifica_hash(annotazioni_sha256_, verifiche.annotazioni_sha256);
    richiedi(!verifiche.numero_grafie ||
             (*verifiche.numero_grafie <= std::numeric_limits<std::uint32_t>::max() &&
              *verifiche.numero_grafie == n), "Numero grafie incompatibile");
    if (verifiche.artifact_sha256) {
        verifica_hash(dettaglio::sha256_esadecimale(dettaglio::sha256(bytes_.data(), bytes_.size())),
                      verifiche.artifact_sha256);
    }
    const auto checksum = dettaglio::sha256(bytes_.data() + header_size, bytes_.size() - header_size);
    richiedi(std::equal(checksum.begin(), checksum.end(), bytes_.begin() + 128), "Checksum payload errato");

    std::vector<std::uint32_t> cardinalita;
    richiedi(n <= cardinalita.max_size() && k <= colonne_.max_size(), "Allocazione non rappresentabile");
    cardinalita.resize(come_size(n), 0);
    colonne_.reserve(come_size(k));
    std::uint64_t totale = 0;
    std::uint32_t precedente = 0;
    for (std::uint64_t j = 0; j < k; ++j) {
        const auto posizione = come_size(somma(directory_at, prodotto(j, 16)));
        const auto valore = static_cast<std::uint32_t>(leggi_le(bytes_, posizione, 4));
        const auto popolazione = static_cast<std::uint32_t>(leggi_le(bytes_, posizione + 4, 4));
        const auto offset64 = somma(bitmap_at, prodotto(j, stride));
        richiedi(valore > precedente, "Conteggi nulli, duplicati o non ordinati");
        richiedi(popolazione > 0 && popolazione <= n && leggi_le(bytes_, posizione + 8, 8) == offset64,
                 "Popolazione/offset directory non canonico");
        const auto offset = come_size(offset64);
        if (n % 8 != 0) {
            richiedi((bytes_[offset + stride_ - 1] >> (n % 8)) == 0, "Padding bitmap non zero");
        }
        std::uint64_t effettiva = 0;
        for (std::size_t b = 0; b < stride_; ++b) {
            effettiva += popcount_byte(bytes_[offset + b]);
        }
        richiedi(effettiva == popolazione, "Popolazione diversa dal popcount");
        totale = somma(totale, effettiva);
        richiedi(totale <= m, "Membership eccedenti");
        for (std::size_t b = 0; b < stride_; ++b) {
            const auto bits = bytes_[offset + b];
            for (unsigned bit = 0; bit < 8; ++bit) {
                if ((bits & (1u << bit)) != 0) {
                    ++cardinalita[b * 8 + bit];
                }
            }
        }
        colonne_.push_back({valore, popolazione, offset});
        precedente = valore;
    }
    richiedi(totale == m, "Numero membership incoerente");
    for (std::size_t i = 0; i < cardinalita.size(); ++i) {
        valida_metadata(bytes_, come_size(somma(header_size, prodotto(i, 8))), cardinalita[i]);
    }
}

std::uint32_t RuntimeSillabe::numero_conteggi_distinti() const {
    return static_cast<std::uint32_t>(colonne_.size());
}

void RuntimeSillabe::verifica_indice(std::size_t indice) const {
    if (bytes_.size() < header_size || indice >= numero_grafie_) {
        throw std::out_of_range("Indice parola fuori range");
    }
}

std::size_t RuntimeSillabe::cerca_colonna(std::uint64_t numero_sillabe) const {
    richiedi(numero_sillabe >= 1 && numero_sillabe <= std::numeric_limits<std::uint32_t>::max(),
             "Numero sillabe non uint32 positivo");
    const auto it = std::lower_bound(colonne_.begin(), colonne_.end(), numero_sillabe,
        [](const Colonna& colonna, std::uint64_t numero) { return colonna.conteggio < numero; });
    if (it == colonne_.end() || it->conteggio != numero_sillabe) {
        return colonne_.size();
    }
    return static_cast<std::size_t>(it - colonne_.begin());
}

bool RuntimeSillabe::compatibile(std::size_t indice, std::uint64_t numero_sillabe) const {
    verifica_indice(indice);
    const auto j = cerca_colonna(numero_sillabe);
    return j != colonne_.size() && (bytes_[colonne_[j].offset + indice / 8] & (1u << (indice % 8))) != 0;
}

std::vector<std::size_t> RuntimeSillabe::indici_compatibili(std::uint64_t numero_sillabe) const {
    return indici_compatibili(FiltroSillabe::esattamente(numero_sillabe));
}

std::pair<std::size_t, std::size_t> RuntimeSillabe::colonne_per_filtro(const FiltroSillabe& filtro) const {
    const auto inizio = std::lower_bound(colonne_.begin(), colonne_.end(), filtro.minimo(),
        [](const Colonna& colonna, std::uint32_t numero) { return colonna.conteggio < numero; });
    const auto fine = filtro.minimo() == filtro.massimo()
        ? (inizio != colonne_.end() && inizio->conteggio == filtro.minimo() ? inizio + 1 : inizio)
        : std::upper_bound(inizio, colonne_.end(), filtro.massimo(),
            [](std::uint32_t numero, const Colonna& colonna) { return numero < colonna.conteggio; });
    return {static_cast<std::size_t>(inizio - colonne_.begin()),
            static_cast<std::size_t>(fine - colonne_.begin())};
}

bool RuntimeSillabe::compatibile(std::size_t indice, const FiltroSillabe& filtro) const {
    verifica_indice(indice);
    const auto intervallo = colonne_per_filtro(filtro);
    for (auto j = intervallo.first; j < intervallo.second; ++j) {
        if ((bytes_[colonne_[j].offset + indice / 8] & (1u << (indice % 8))) != 0) {
            return true;
        }
    }
    return false;
}

std::vector<std::size_t> RuntimeSillabe::indici_compatibili(const FiltroSillabe& filtro) const {
    const auto intervallo = colonne_per_filtro(filtro);
    if (intervallo.first == intervallo.second) {
        return {};
    }
    std::vector<std::size_t> indici;
    if (intervallo.second - intervallo.first == 1) {
        indici.reserve(colonne_[intervallo.first].popolazione);
    }
    for (std::size_t b = 0; b < stride_; ++b) {
        std::uint8_t bits = 0;
        // Unione per byte: niente lista duplicata o bitmap completa temporanea.
        for (auto j = intervallo.first; j < intervallo.second; ++j) {
            bits |= bytes_[colonne_[j].offset + b];
        }
        for (unsigned bit = 0; bit < 8; ++bit) {
            if ((bits & (1u << bit)) != 0) {
                indici.push_back(b * 8 + bit);
            }
        }
    }
    return indici;
}

VoceSillabica RuntimeSillabe::voce(std::size_t indice) const {
    verifica_indice(indice);
    const auto posizione = come_size(somma(header_size, prodotto(indice, 8)));
    VoceSillabica voce{{}, static_cast<StatoSillabico>(bytes_[posizione + 4]),
        static_cast<OrigineSillabica>(bytes_[posizione + 5]),
        static_cast<std::uint32_t>(leggi_le(bytes_, posizione, 4))};
    for (const auto& colonna : colonne_) {
        if ((bytes_[colonna.offset + indice / 8] & (1u << (indice % 8))) != 0) {
            voce.conteggi.push_back(colonna.conteggio);
        }
    }
    return voce;
}

} // namespace anagrammi
