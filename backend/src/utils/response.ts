export function successResponse(data: any, message = "Success") {
  return {
    success: true,
    data,
    message,
    timestamp: new Date().toISOString()
  };
}

export function errorResponse(message: string, code = 500) {
  return {
    success: false,
    data: null,
    message,
    code,
    timestamp: new Date().toISOString()
  };
}
