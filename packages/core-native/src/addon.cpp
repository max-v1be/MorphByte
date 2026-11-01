#include <node_api.h>
#include <atomic>
#include <cstdint>
#include <exception>
#include <memory>
#include <string>
#include <vector>

namespace
{
constexpr std::size_t maxBytes = 64 * 1024 * 1024;
constexpr unsigned maxJobs = 8;
std::atomic_uint activeJobs{0};

struct Job
{
    napi_async_work work{};
    napi_deferred deferred{};
    std::vector<std::uint8_t> input;
    std::string output;
    std::string error;
};


void execute(napi_env, void* context) noexcept
{
    auto& job = *static_cast<Job*>(context);
    constexpr char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    try
    {
        job.output.reserve(((job.input.size() + 2) / 3) * 4);
        for (std::size_t i = 0; i < job.input.size(); i += 3)
        {
            const auto remaining = job.input.size() - i;
            const auto word = (std::uint32_t(job.input[i]) << 16) |
                (remaining > 1 ? std::uint32_t(job.input[i + 1]) << 8 : 0) |
                (remaining > 2 ? job.input[i + 2] : 0);
            job.output.push_back(alphabet[(word >> 18) & 63]);
            job.output.push_back(alphabet[(word >> 12) & 63]);
            job.output.push_back(remaining > 1 ? alphabet[(word >> 6) & 63] : '=');
            job.output.push_back(remaining > 2 ? alphabet[word & 63] : '=');
        }

    }

    catch (const std::exception& error)
    {
        job.error = error.what();
    }

    catch (...)
    {
        job.error = "Unknown native encoding error";
    }

}


void complete(napi_env env, napi_status status, void* context)
{
    std::unique_ptr<Job> job(static_cast<Job*>(context)); // Reclaim the queued job.
    napi_value value;
    if (status != napi_ok || !job->error.empty())
    {
        const char* message = status == napi_cancelled
            ? "MorphByte: native task cancelled"
            : job->error.c_str();
        napi_value text;
        napi_create_string_utf8(env, message, NAPI_AUTO_LENGTH, &text);
        napi_create_error(env, nullptr, text, &value);
        napi_reject_deferred(env, job->deferred, value);
    }

    else
    {
        const auto result = napi_create_string_utf8(
            env, job->output.data(), job->output.size(), &value);
        if (result == napi_ok)
        {
            napi_resolve_deferred(env, job->deferred, value);
        }

        else
        {
            napi_value message;
            napi_create_string_utf8(env, "MorphByte: allocation failed", NAPI_AUTO_LENGTH, &message);
            napi_create_error(env, nullptr, message, &value);
            napi_reject_deferred(env, job->deferred, value);
        }

    }

    napi_delete_async_work(env, job->work);
    --activeJobs;
}


napi_value encode(napi_env env, napi_callback_info info)
{
    std::size_t argumentCount = 1;
    napi_value argument;
    napi_get_cb_info(env, info, &argumentCount, &argument, nullptr, nullptr);
    bool isBuffer = false;
    if (argumentCount != 1 ||
        napi_is_buffer(env, argument, &isBuffer) != napi_ok || !isBuffer)
    {
        napi_throw_type_error(env, "INVALID_INPUT", "MorphByte: encodeBase64 expects Buffer");
        return nullptr;
    }

    void* bytes = nullptr;
    std::size_t size = 0;
    if (napi_get_buffer_info(env, argument, &bytes, &size) != napi_ok || size > maxBytes)
    {
        napi_throw_range_error(env, "LIMIT_EXCEEDED", "MorphByte: native input exceeds 64 MiB");
        return nullptr;
    }

    if (activeJobs.fetch_add(1) >= maxJobs)
    {
        --activeJobs;
        napi_throw_error(env, "LIMIT_EXCEEDED", "MorphByte: native queue is full");
        return nullptr;
    }

    std::unique_ptr<Job> job;
    try
    {
        job = std::make_unique<Job>();
        const auto* begin = static_cast<const std::uint8_t*>(bytes);
        if (size)
        {
            job->input.assign(begin, begin + size);
        }

    }

    catch (...)
    {
        --activeJobs;
        napi_throw_error(env, "LIMIT_EXCEEDED", "MorphByte: native allocation failed");
        return nullptr;
    }

    napi_value promise;
    napi_value name;
    if (napi_create_promise(env, &job->deferred, &promise) != napi_ok ||
        napi_create_string_utf8(env, "morphbyte-native/base64", NAPI_AUTO_LENGTH, &name) != napi_ok ||
        napi_create_async_work(
            env, nullptr, name, execute, complete, job.get(), &job->work) != napi_ok)
    {
        --activeJobs;
        napi_throw_error(env, "ENCODER_ERROR", "MorphByte: failed to create native task");
        return nullptr;
    }

    if (napi_queue_async_work(env, job->work) != napi_ok)
    {
        napi_delete_async_work(env, job->work);
        --activeJobs;
        napi_throw_error(env, "ENCODER_ERROR", "MorphByte: failed to queue native task");
        return nullptr;
    }

    job.release(); // The completion callback now owns the job.
    return promise;
}


napi_value init(napi_env env, napi_value exports)
{
    napi_property_descriptor descriptor{
        "encodeBase64", nullptr, encode, nullptr, nullptr, nullptr, napi_default, nullptr};
    napi_define_properties(env, exports, 1, &descriptor);
    return exports;
}

}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
