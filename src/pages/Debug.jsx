import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, CheckCircle, Loader2 } from "lucide-react";

export default function Debug() {
  const [optionsResult, setOptionsResult] = useState(null);
  const [getResult, setGetResult] = useState(null);
  const [postResult, setPostResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const testOptions = async () => {
    setLoading(true);
    setOptionsResult(null);
    try {
      const response = await fetch("https://web-production-eba27.up.railway.app/v1/jobs", {
        method: "OPTIONS",
      });
      setOptionsResult({
        status: response.status,
        statusText: response.statusText,
        headers: {
          'Access-Control-Allow-Origin': response.headers.get('Access-Control-Allow-Origin'),
          'Access-Control-Allow-Methods': response.headers.get('Access-Control-Allow-Methods'),
          'Access-Control-Allow-Headers': response.headers.get('Access-Control-Allow-Headers'),
        },
        success: true
      });
    } catch (error) {
      setOptionsResult({ error: error.message, success: false });
    }
    setLoading(false);
  };

  const testGet = async () => {
    setLoading(true);
    setGetResult(null);
    try {
      const response = await fetch("https://web-production-eba27.up.railway.app/v1/jobs/test123");
      const text = await response.text();
      setGetResult({
        status: response.status,
        statusText: response.statusText,
        body: text,
        success: true
      });
    } catch (error) {
      setGetResult({ error: error.message, success: false });
    }
    setLoading(false);
  };

  const testPost = async () => {
    setLoading(true);
    setPostResult(null);
    
    const payload = {
      mediaUrl: "https://example.com/test.mp4",
      speaker_labels: true,
      language_detection: true,
      rules: {
        maxCaptionsPerSecond: 20,
        maxCharactersPerSecond: 20,
        maxLinesPerCaption: 2
      }
    };

    try {
      const response = await fetch("https://web-production-eba27.up.railway.app/v1/jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload)
      });
      const text = await response.text();
      setPostResult({
        requestPayload: payload,
        status: response.status,
        statusText: response.statusText,
        responseBody: text,
        success: response.ok
      });
    } catch (error) {
      setPostResult({ 
        requestPayload: payload,
        error: error.message, 
        success: false 
      });
    }
    setLoading(false);
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-white mb-6">API Debug Panel</h1>

        <div className="space-y-6">
          {/* OPTIONS Test */}
          <Card className="bg-zinc-900/30 border-zinc-800">
            <CardHeader>
              <CardTitle className="text-lg text-zinc-200">OPTIONS Request Test</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button 
                onClick={testOptions} 
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Run OPTIONS /v1/jobs
              </Button>

              {optionsResult && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    {optionsResult.success ? (
                      <CheckCircle className="w-5 h-5 text-green-500" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-red-500" />
                    )}
                    <span className="text-sm font-medium text-zinc-300">
                      {optionsResult.success ? "Success" : "Failed"}
                    </span>
                  </div>
                  <pre className="text-xs text-zinc-400 overflow-auto">
                    {JSON.stringify(optionsResult, null, 2)}
                  </pre>
                </div>
              )}
            </CardContent>
          </Card>

          {/* GET Test */}
          <Card className="bg-zinc-900/30 border-zinc-800">
            <CardHeader>
              <CardTitle className="text-lg text-zinc-200">GET Request Test</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button 
                onClick={testGet} 
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Run GET /v1/jobs/test123
              </Button>

              {getResult && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    {getResult.success ? (
                      <CheckCircle className="w-5 h-5 text-green-500" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-red-500" />
                    )}
                    <span className="text-sm font-medium text-zinc-300">
                      {getResult.success ? "Success" : "Failed"}
                    </span>
                  </div>
                  <pre className="text-xs text-zinc-400 overflow-auto">
                    {JSON.stringify(getResult, null, 2)}
                  </pre>
                </div>
              )}
            </CardContent>
          </Card>

          {/* POST Test */}
          <Card className="bg-zinc-900/30 border-zinc-800">
            <CardHeader>
              <CardTitle className="text-lg text-zinc-200">POST Request Test (Create Job)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button 
                onClick={testPost} 
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Run POST /v1/jobs
              </Button>

              {postResult && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    {postResult.success ? (
                      <CheckCircle className="w-5 h-5 text-green-500" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-red-500" />
                    )}
                    <span className="text-sm font-medium text-zinc-300">
                      {postResult.success ? "Success" : "Failed"}
                    </span>
                  </div>
                  <pre className="text-xs text-zinc-400 overflow-auto max-h-96">
                    {JSON.stringify(postResult, null, 2)}
                  </pre>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}